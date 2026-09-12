"use strict";

const { CHAINS } = require("./chains");
const { resilientFetchJSON } = require("./resilientFetch");
const { cached } = require("./dataCache");
const { blockscoutInstances } = require("./coinsData");

const NFT_TTL_MS = 30000;

function blockscoutTokens(chainKey, type, sort, order) {
  const base = CHAINS[chainKey].explorerUrl;
  const params = [];
  if (type) params.push("type=" + encodeURIComponent(type));
  if (sort) params.push("sort=" + encodeURIComponent(sort));
  if (order) params.push("order=" + encodeURIComponent(order));
  const qs = params.length ? "?" + params.join("&") : "";
  return resilientFetchJSON(base + "/api/v2/tokens" + qs, { timeoutMs: 9000, retries: 2 }).then(
    (data) => ((data && data.items) || []).slice(0, 24)
  );
}

function getNftList(chainKey) {
  if (CHAINS[chainKey].supportsBlockscout === false) {
    // No Blockscout instance for this chain (e.g. Solana) — nothing to fetch, and no point retrying.
    return Promise.resolve({ data: [], stale: false, updatedAt: Date.now(), warning: null });
  }
  return cached(`nft:${chainKey}`, () => blockscoutTokens(chainKey, "ERC-721,ERC-1155,ERC-404", "holders_count", "desc"), {
    ttlMs: NFT_TTL_MS,
  });
}

function getNftInstances(chainKey, address) {
  return blockscoutInstances(chainKey, address);
}

module.exports = { getNftList, getNftInstances };
