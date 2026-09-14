"use strict";

const { CHAINS } = require("./chains");
const { resilientFetchJSON } = require("./resilientFetch");
const { cached } = require("./dataCache");
const { extractAddress, safeMap } = require("./util");
const { blockscoutInstances } = require("./coinsData");
const watchlist = require("./watchlist");

const NFT_TTL_MS = 30000;
const NFT_NEW_TTL_MS = 90000; // "Freshly listed" does extra per-contract lookups — cache it longer
const NFT_TYPES = "ERC-721,ERC-1155,ERC-404";

function blockscoutTokens(chainKey, type, sort, order) {
  const base = CHAINS[chainKey].explorerUrl;
  const params = [];
  if (type) params.push("type=" + encodeURIComponent(type));
  if (sort) params.push("sort=" + encodeURIComponent(sort));
  if (order) params.push("order=" + encodeURIComponent(order));
  const qs = params.length ? "?" + params.join("&") : "";
  // Kept tight on purpose: 2 attempts at 9s each (plus backoff) could exceed a
  // serverless function's execution ceiling (10s by default on Vercel Hobby),
  // which kills the whole request before our own retry/fallback logic ever
  // gets to run — worse than just trying once and failing fast.
  return resilientFetchJSON(base + "/api/v2/tokens" + qs, { timeoutMs: 7000, retries: 1 }).then(
    (data) => (data && data.items) || []
  );
}

function blockscoutTokenDetail(chainKey, address) {
  const base = CHAINS[chainKey].explorerUrl;
  return resilientFetchJSON(base + "/api/v2/tokens/" + address, { timeoutMs: 7000, retries: 1 });
}

/**
 * Blockscout has no "deployed at" field on the token itself, and no sort
 * option for it either — the only way to get a real creation date is two
 * more hops: the contract address's creation_transaction_hash, then that
 * transaction's timestamp. Returns null (not thrown) on any failure, so one
 * slow/missing lookup just sinks that item to the bottom rather than
 * breaking the whole "Freshly listed" list.
 */
async function getContractDeployedAt(chainKey, address) {
  const base = CHAINS[chainKey].explorerUrl;
  try {
    const info = await resilientFetchJSON(base + "/api/v2/addresses/" + address, { timeoutMs: 7000, retries: 1 });
    const txHash = info && info.creation_transaction_hash;
    if (!txHash) return null;
    const tx = await resilientFetchJSON(base + "/api/v2/transactions/" + txHash, { timeoutMs: 7000, retries: 1 });
    const ts = tx && tx.timestamp ? Date.parse(tx.timestamp) : NaN;
    return isFinite(ts) ? ts : null;
  } catch (e) {
    return null;
  }
}

async function loadMostHeld(chainKey) {
  const items = await blockscoutTokens(chainKey, NFT_TYPES, "holders_count", "desc");
  return items.slice(0, 24);
}

/**
 * "Freshly listed" for NFTs, given the constraints above: re-sorts the same
 * top-24-by-holders set by actual deployment date, newest first. This is a
 * real date, but it can only ever surface collections that are already
 * popular enough to be in that top-24 — Blockscout has no global "newest NFT
 * contracts" feed the way DexScreener does for coin pairs, so a brand-new,
 * still-obscure collection won't show up here until it's also widely held.
 */
async function loadFreshlyListed(chainKey) {
  const candidates = await loadMostHeld(chainKey);
  const withDates = await Promise.allSettled(
    candidates.map((item) => getContractDeployedAt(chainKey, extractAddress(item)))
  );
  const paired = candidates.map((item, i) => ({
    item,
    deployedAt: withDates[i].status === "fulfilled" ? withDates[i].value : null,
  }));
  paired.sort((a, b) => (b.deployedAt || 0) - (a.deployedAt || 0));
  return paired.map((p) => {
    // Surface the resolved date on the item itself so the frontend can show it
    // without needing a separate field mapping.
    if (p.deployedAt) p.item._deployedAt = p.deployedAt;
    return p.item;
  });
}

async function loadWatchedNfts(chainKey) {
  const watched = watchlist.listForChain(chainKey, "nft");
  if (!watched.length) return [];
  const results = await Promise.allSettled(watched.map((w) => blockscoutTokenDetail(chainKey, w.address)));
  return safeMap(results, (r) => (r.status === "fulfilled" && r.value ? r.value : null));
}

function getNftFeed(chainKey, feed) {
  if (CHAINS[chainKey].supportsBlockscout === false) {
    // No Blockscout instance for this chain (e.g. Solana) — nothing to fetch, and no point retrying.
    return Promise.resolve({ data: [], stale: false, updatedAt: Date.now(), warning: null });
  }
  if (feed === "new") {
    return cached(`nft:new:${chainKey}`, () => loadFreshlyListed(chainKey), { ttlMs: NFT_NEW_TTL_MS });
  }
  if (feed === "watch") {
    // Short TTL: mainly to coalesce concurrent requests right after a star/unstar, not to hide fresh data.
    return cached(`nft:watch:${chainKey}`, () => loadWatchedNfts(chainKey), { ttlMs: 5000 });
  }
  return cached(`nft:mostheld:${chainKey}`, () => loadMostHeld(chainKey), { ttlMs: NFT_TTL_MS });
}

function getNftInstances(chainKey, address) {
  return blockscoutInstances(chainKey, address);
}

module.exports = { getNftFeed, getNftInstances };
