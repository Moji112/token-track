"use strict";

const { CHAINS, DEX_API, explorerAddressUrl, normalizeAddress } = require("./chains");
const { resilientFetchJSON } = require("./resilientFetch");
const { numOr0, safeUrl, extractAddress, computeSupplyDisplay, safeMap } = require("./util");
const { cached } = require("./dataCache");
const watchlist = require("./watchlist");

const ROW_TTL_MS = 25000; // how fresh a composed row list needs to be before we re-fetch
const DISCOVERY_TTL_MS = 25000;

let discoveryState = { profiles: [], boosts: [], loadedAt: 0 };

function normalizeList(raw) {
  if (Array.isArray(raw)) return raw;
  if (raw && Array.isArray(raw.data)) return raw.data;
  return [];
}

function blockscoutTokens(chainKey, type, sort, order) {
  const base = CHAINS[chainKey].explorerUrl;
  const params = [];
  if (type) params.push("type=" + encodeURIComponent(type));
  if (sort) params.push("sort=" + encodeURIComponent(sort));
  if (order) params.push("order=" + encodeURIComponent(order));
  const qs = params.length ? "?" + params.join("&") : "";
  return resilientFetchJSON(base + "/api/v2/tokens" + qs, { timeoutMs: 9000, retries: 2 }).then(
    (data) => (data && data.items) || []
  );
}

function blockscoutInstances(chainKey, tokenAddress) {
  const base = CHAINS[chainKey].explorerUrl;
  return resilientFetchJSON(base + "/api/v2/tokens/" + tokenAddress + "/instances", {
    timeoutMs: 9000,
    retries: 1,
  }).then((data) => (data && data.items) || []);
}

function dexEnrich(chainKey, addresses) {
  const chainId = CHAINS[chainKey].dexId;
  const list = addresses.slice(0, 30);
  if (!list.length) return Promise.resolve({});
  const wanted = new Set(list.map((a) => normalizeAddress(chainKey, a)));
  return resilientFetchJSON(DEX_API + "/latest/dex/tokens/" + list.join(","), {
    timeoutMs: 9000,
    retries: 2,
  })
    .then((data) => {
      const pairs = (data && data.pairs) || [];
      const out = {};
      pairs.forEach((p) => {
        if (p.chainId !== chainId || !p.baseToken || !p.baseToken.address) return;
        const key = normalizeAddress(chainKey, p.baseToken.address);
        // Same fix as enrichTokens: DexScreener returns pairs where a requested
        // address is on either side, so a widely-quoted token (USDT, WETH, ...)
        // would otherwise get attributed some unrelated pair's data.
        if (!wanted.has(key)) return;
        const liq = numOr0(p.liquidity && p.liquidity.usd);
        if (!out[key] || liq > numOr0(out[key].liquidity && out[key].liquidity.usd)) out[key] = p;
      });
      return out;
    })
    .catch(() => ({})); // DexScreener being down shouldn't block explorer-only data
}

async function loadDiscoveryFeeds(force) {
  if (!force && Date.now() - discoveryState.loadedAt < DISCOVERY_TTL_MS) return discoveryState;

  const results = await Promise.allSettled([
    resilientFetchJSON(DEX_API + "/token-profiles/latest/v1", { timeoutMs: 9000, retries: 1 }),
    resilientFetchJSON(DEX_API + "/token-boosts/latest/v1", { timeoutMs: 9000, retries: 1 }),
    resilientFetchJSON(DEX_API + "/token-boosts/top/v1", { timeoutMs: 9000, retries: 1 }),
  ]);

  const anyOk = results.some((r) => r.status === "fulfilled");
  if (!anyOk) {
    if (discoveryState.loadedAt) return discoveryState; // keep last-known-good rather than blowing up
    const err = new Error("DexScreener discovery feeds unreachable");
    throw err;
  }

  const profiles = normalizeList(results[0].status === "fulfilled" ? results[0].value : []);
  const boostsLatest = normalizeList(results[1].status === "fulfilled" ? results[1].value : []);
  const boostsTop = normalizeList(results[2].status === "fulfilled" ? results[2].value : []);
  const combined = boostsLatest.concat(boostsTop);
  const seen = {};
  const boosts = combined.filter((b) => {
    const k = b.chainId + ":" + b.tokenAddress;
    if (seen[k]) return false;
    seen[k] = true;
    return true;
  });

  discoveryState = { profiles, boosts, loadedAt: Date.now() };
  return discoveryState;
}

function enrichTokens(chainKey, candidates) {
  const chainId = CHAINS[chainKey].dexId;
  const filtered = candidates.filter((c) => c.chainId === chainId && c.tokenAddress);
  const addrSet = {};
  const addrs = [];
  filtered.forEach((c) => {
    const a = c.tokenAddress;
    if (!addrSet[a]) {
      addrSet[a] = true;
      addrs.push(a);
    }
  });
  const list = addrs.slice(0, 30);
  if (!list.length) return Promise.resolve([]);
  const wanted = new Set(list.map((a) => normalizeAddress(chainKey, a)));
  return resilientFetchJSON(DEX_API + "/latest/dex/tokens/" + list.join(","), {
    timeoutMs: 9000,
    retries: 2,
  }).then((data) => {
    const pairs = (data && data.pairs) || [];
    const byToken = {};
    pairs.forEach((p) => {
      if (p.chainId !== chainId || !p.baseToken || !p.baseToken.address) return;
      const key = normalizeAddress(chainKey, p.baseToken.address);
      // DexScreener's token endpoint returns every pair that includes any requested
      // address on EITHER side — a widely-quoted token (USDT, WETH, ...) pulls in
      // pairs where it's the quote side and something unrelated is the base. Only
      // keep pairs whose base token is actually one of the addresses we asked about.
      if (!wanted.has(key)) return;
      const liq = numOr0(p.liquidity && p.liquidity.usd);
      const existing = byToken[key];
      if (!existing || liq > numOr0(existing.liquidity && existing.liquidity.usd)) byToken[key] = p;
    });
    return Object.keys(byToken).map((key) => {
      const p = byToken[key];
      const meta = filtered.filter((c) => normalizeAddress(chainKey, c.tokenAddress) === key)[0];
      const copy = JSON.parse(JSON.stringify(p));
      copy._boosted = !!(meta && meta.amount !== undefined);
      copy._icon = meta && meta.icon;
      return copy;
    });
  });
}

function buildCoinRow(o) {
  const dex = o.dex;
  return {
    address: o.address,
    symbol: o.symbol || "?",
    name: o.name || "",
    iconUrl: safeUrl(o.iconUrl) || (dex && safeUrl(dex.info && dex.info.imageUrl)) || "",
    source: o.source,
    boosted: !!(dex && dex._boosted),
    holders: o.holders !== undefined && o.holders !== null ? o.holders : null,
    totalSupplyDisplay: computeSupplyDisplay(o.totalSupply, o.decimals),
    hasDex: !!dex,
    priceUsd: dex && dex.priceUsd !== undefined && dex.priceUsd !== null ? Number(dex.priceUsd) : null,
    priceChangeH24: dex ? dex.priceChange && dex.priceChange.h24 : null,
    priceChangeH1: dex ? dex.priceChange && dex.priceChange.h1 : null,
    buysH1: dex && dex.txns && dex.txns.h1 ? numOr0(dex.txns.h1.buys) : null,
    sellsH1: dex && dex.txns && dex.txns.h1 ? numOr0(dex.txns.h1.sells) : null,
    liquidityUsd: dex ? dex.liquidity && dex.liquidity.usd : null,
    volumeH24: dex ? dex.volume && dex.volume.h24 : null,
    pairCreatedAt: dex ? dex.pairCreatedAt : null,
    pairAddress: dex ? dex.pairAddress || null : null,
    exchangeRateUsd: o.exchangeRateUsd !== undefined && o.exchangeRateUsd !== null ? o.exchangeRateUsd : null,
    circulatingMarketCap:
      o.circulatingMarketCap !== undefined && o.circulatingMarketCap !== null
        ? o.circulatingMarketCap
        : dex && dex.marketCap != null
        ? Number(dex.marketCap)
        : dex && dex.fdv != null
        ? Number(dex.fdv)
        : null,
    chartUrl: dex ? dex.url || null : null,
    explorerUrl: explorerAddressUrl(o.chainKey, o.address),
    chainKey: o.chainKey,
  };
}

function coinRowFromPair(pair, chainKey, source) {
  const addr = normalizeAddress(chainKey, (pair.baseToken && pair.baseToken.address) || "");
  return buildCoinRow({
    address: addr,
    symbol: pair.baseToken && pair.baseToken.symbol,
    name: pair.baseToken && pair.baseToken.name,
    iconUrl: (pair.info && pair.info.imageUrl) || pair._icon,
    holders: null,
    totalSupply: null,
    decimals: null,
    exchangeRateUsd: null,
    circulatingMarketCap: null,
    dex: pair,
    chainKey,
    source,
  });
}

function enrichTokensAsRows(chainKey, candidates, source) {
  return enrichTokens(chainKey, candidates).then((pairs) =>
    safeMap(pairs, (p) => coinRowFromPair(p, chainKey, source))
  );
}

async function loadMostHeld(chainKey) {
  const tokens = (await blockscoutTokens(chainKey, "ERC-20", "holders_count", "desc")).slice(0, 40);
  const addrs = safeMap(tokens, (t) => extractAddress(t) || null);
  const dexMap = await dexEnrich(chainKey, addrs);
  return safeMap(tokens, (t) => {
    const addr = normalizeAddress(chainKey, extractAddress(t));
    if (!addr) return null;
    const dex = dexMap[addr] || null;
    return buildCoinRow({
      address: addr,
      symbol: t.symbol,
      name: t.name,
      iconUrl: t.icon_url,
      holders: t.holders_count != null ? Number(t.holders_count) : null,
      totalSupply: t.total_supply,
      decimals: t.decimals != null ? Number(t.decimals) : 18,
      exchangeRateUsd: t.exchange_rate != null ? Number(t.exchange_rate) : null,
      circulatingMarketCap: t.circulating_market_cap != null ? Number(t.circulating_market_cap) : null,
      dex,
      chainKey,
      source: "mostheld",
    });
  });
}

async function loadFeedRows(chainKey, feed) {
  if (feed === "mostheld") {
    // "Most held" is sorted by Blockscout's holder count, which only exists for EVM chains
    // Blockscout indexes — there's nothing to fetch for a chain like Solana.
    if (CHAINS[chainKey].supportsBlockscout === false) return [];
    return loadMostHeld(chainKey);
  }
  if (feed === "watch") {
    const watched = watchlist.listForChain(chainKey);
    if (!watched.length) return [];
    const candidates = watched.map((w) => ({ chainId: CHAINS[chainKey].dexId, tokenAddress: w.address }));
    return enrichTokensAsRows(chainKey, candidates, "watch");
  }
  const discovery = await loadDiscoveryFeeds(false);
  const source = feed === "new" ? discovery.profiles : discovery.boosts;
  return enrichTokensAsRows(chainKey, source, feed);
}

/** Cached, resilient entry point used by both the HTTP routes and the background monitor. */
function getRows(chainKey, feed) {
  // The watchlist can change between two requests a user makes seconds apart (star/unstar) —
  // cache it very briefly rather than not at all, mainly to coalesce concurrent requests.
  const ttlMs = feed === "watch" ? 5000 : ROW_TTL_MS;
  return cached(`coins:${chainKey}:${feed}`, () => loadFeedRows(chainKey, feed), { ttlMs });
}

function runSearch(query, chainKey) {
  const chainId = CHAINS[chainKey].dexId;
  return resilientFetchJSON(DEX_API + "/latest/dex/search?q=" + encodeURIComponent(query), {
    timeoutMs: 9000,
    retries: 2,
  }).then((data) => {
    const pairs = (data && data.pairs) || [];
    const byToken = {};
    pairs.forEach((p) => {
      if (p.chainId !== chainId || !p.baseToken || !p.baseToken.address) return;
      const key = normalizeAddress(chainKey, p.baseToken.address);
      const liq = numOr0(p.liquidity && p.liquidity.usd);
      const existing = byToken[key];
      if (!existing || liq > numOr0(existing.liquidity && existing.liquidity.usd)) byToken[key] = p;
    });
    return safeMap(Object.keys(byToken), (k) => coinRowFromPair(byToken[k], chainKey, "search"));
  });
}

module.exports = {
  getRows,
  runSearch,
  blockscoutInstances,
};
