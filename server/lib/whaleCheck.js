"use strict";

/**
 * On-demand, per-token "whale check": who recently bought/sold this specific
 * coin's main pool, and is their wallet currently sitting on $100k+? Not
 * persistent wallet tracking — nothing here is stored, watched over time, or
 * looked up unless a request for this exact token comes in.
 *
 * Reconstructed from two public Blockscout endpoints (EVM chains only):
 *   1) The token's recent Transfer log, read for transfers into/out of its
 *      main trading pool (pool -> wallet = buy, wallet -> pool = sell).
 *   2) Each resulting wallet's current balance (native + priced ERC-20s).
 *
 * Real limitations, same as the reference this was ported from: only sees
 * the token's single highest-liquidity pool, skips contract-to-contract
 * transfers (usually routers), reflects each wallet's balance *right now*
 * rather than at trade time, and only counts holdings Blockscout can price.
 */

const { CHAINS } = require("./chains");
const { resilientFetchJSON } = require("./resilientFetch");
const { numOr0 } = require("./util");

const WHALE_MIN_USD = 100000;
const WHALE_MAX_WALLETS = 12; // unique buyer/seller wallets actually balance-checked
const WHALE_TRANSFER_SCAN = 60; // recent raw transfer rows scanned to find those wallets
const NATIVE_DECIMALS = 18; // every supported Blockscout chain here is an 18-decimal-gas-token EVM chain

function fetchTokenTransfers(chainKey, tokenAddress) {
  const base = CHAINS[chainKey].explorerUrl;
  return resilientFetchJSON(base + "/api/v2/tokens/" + tokenAddress + "/transfers", {
    retries: 1,
    timeoutMs: 9000,
  }).then((data) => (data && data.items) || []);
}

async function fetchWalletUsdSnapshot(chainKey, walletAddress) {
  const base = CHAINS[chainKey].explorerUrl;
  const [info, balances] = await Promise.all([
    resilientFetchJSON(base + "/api/v2/addresses/" + walletAddress, { retries: 1, timeoutMs: 8000 }).catch(() => null),
    resilientFetchJSON(base + "/api/v2/addresses/" + walletAddress + "/token-balances", { retries: 1, timeoutMs: 8000 }).catch(
      () => null
    ),
  ]);

  let usd = 0;
  let known = false;
  if (info && info.coin_balance != null && info.exchange_rate != null) {
    const nativeAmt = Number(info.coin_balance) / Math.pow(10, NATIVE_DECIMALS);
    const nativeRate = Number(info.exchange_rate);
    if (isFinite(nativeAmt) && isFinite(nativeRate)) {
      usd += nativeAmt * nativeRate;
      known = true;
    }
  }
  if (Array.isArray(balances)) {
    for (const entry of balances) {
      const t = entry && entry.token;
      if (!t || t.exchange_rate == null || entry.value == null || t.type !== "ERC-20") continue;
      const decimals = Number(t.decimals);
      const amt = Number(entry.value) / Math.pow(10, isFinite(decimals) ? decimals : 18);
      const rate = Number(t.exchange_rate);
      if (isFinite(amt) && isFinite(rate)) {
        usd += amt * rate;
        known = true;
      }
    }
  }
  return { usd, known };
}

/** Walks the raw transfer log once, pulling unique wallets on each side of the pool, skipping router hops. */
function classifyWhaleTransfers(items, pairAddress) {
  const pair = (pairAddress || "").toLowerCase();
  const buys = [];
  const sells = [];
  const seenBuy = {};
  const seenSell = {};
  const scanned = items.slice(0, WHALE_TRANSFER_SCAN);

  for (const it of scanned) {
    if (!it || !it.from || !it.to) continue;
    const from = (it.from.hash || "").toLowerCase();
    const to = (it.to.hash || "").toLowerCase();
    if (!from || !to || from === to || !pair) continue;
    if (from === pair && !it.to.is_contract && !seenBuy[to]) {
      seenBuy[to] = true;
      buys.push(to);
    } else if (to === pair && !it.from.is_contract && !seenSell[from]) {
      seenSell[from] = true;
      sells.push(from);
    }
  }
  return { buys: buys.slice(0, WHALE_MAX_WALLETS), sells: sells.slice(0, WHALE_MAX_WALLETS) };
}

/**
 * Runs the full check. Returns { status: 'done', buyWhales, sellWhales, buyChecked, sellChecked }
 * or { status: 'error', message }. Never throws.
 */
async function runWhaleCheck(chainKey, tokenAddress, pairAddress) {
  if (!CHAINS[chainKey] || CHAINS[chainKey].supportsBlockscout === false) {
    return { status: "error", message: "Whale check needs a Blockscout explorer, which isn't available for this chain." };
  }
  if (!pairAddress) {
    return { status: "error", message: "No trading-pool address on file for this coin yet — refresh the list and try again." };
  }

  let items;
  try {
    items = await fetchTokenTransfers(chainKey, tokenAddress);
  } catch (err) {
    return { status: "error", message: `Couldn't reach ${CHAINS[chainKey].explorerLabel} right now — try again in a bit.` };
  }

  const classified = classifyWhaleTransfers(items, pairAddress);
  const wallets = classified.buys.concat(classified.sells.filter((w) => !classified.buys.includes(w)));

  if (!wallets.length) {
    return { status: "done", buyWhales: [], sellWhales: [], buyChecked: 0, sellChecked: 0 };
  }

  const results = await Promise.allSettled(
    wallets.map((w) => fetchWalletUsdSnapshot(chainKey, w).then((snap) => ({ address: w, usd: snap.usd, known: snap.known })))
  );
  const byAddr = {};
  results.forEach((r, i) => {
    byAddr[wallets[i]] = r.status === "fulfilled" ? r.value : { address: wallets[i], usd: 0, known: false };
  });

  const buyWhales = classified.buys.map((a) => byAddr[a]).filter((s) => s.known && numOr0(s.usd) >= WHALE_MIN_USD);
  const sellWhales = classified.sells.map((a) => byAddr[a]).filter((s) => s.known && numOr0(s.usd) >= WHALE_MIN_USD);

  return {
    status: "done",
    buyWhales,
    sellWhales,
    buyChecked: classified.buys.length,
    sellChecked: classified.sells.length,
  };
}

module.exports = { runWhaleCheck, WHALE_MIN_USD };
