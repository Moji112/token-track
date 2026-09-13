"use strict";

const { CHAINS } = require("./chains");
const coinsData = require("./coinsData");
const settings = require("./settingsService");
const alertTracker = require("./alertTracker");
const discord = require("./discordClient");
const watchlist = require("./watchlist");
const events = require("./events");
const store = require("./store");

const TICK_INTERVAL_MS = 30000;
const CHAIN_STAGGER_MS = 2000;
const FEEDS = ["mostheld", "new", "boosted"];
const WATCH_MOVE_PCT = 15; // 1h price move that counts as a "big move" for a watched coin
const WATCH_NOTIFIED_MAX_AGE_MS = 8 * 24 * 60 * 60 * 1000; // prune dedupe entries older than this

const status = {
  running: false,
  lastTickAt: null,
  lastTickError: null,
  chains: {}, // chainKey -> { lastCheckedAt, lastError, checkedRows }
  alertsSent: 0,
  lastAlertAt: null,
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function checkChainThreshold(chainKey) {
  const chainStatus = (status.chains[chainKey] = status.chains[chainKey] || {});
  const threshold = settings.getLiquidityThreshold();
  const webhookReady = settings.isWebhookConfigured();
  const byAddress = new Map();

  const feeds = FEEDS.concat(watchlist.listForChain(chainKey).length ? ["watch"] : []);
  for (const feed of feeds) {
    try {
      const result = await coinsData.getRows(chainKey, feed);
      for (const row of result.data || []) {
        if (row && row.address && !byAddress.has(row.address)) byAddress.set(row.address, row);
      }
      chainStatus.lastError = null;
    } catch (err) {
      // One feed failing shouldn't stop the others, or stop monitoring this chain going forward.
      chainStatus.lastError = err && err.message ? err.message : "fetch failed";
    }
  }

  chainStatus.lastCheckedAt = Date.now();
  chainStatus.checkedRows = byAddress.size;

  checkWatchlistMoves(chainKey, byAddress);

  if (threshold === null) return; // threshold alerting is off until a threshold is set

  for (const row of byAddress.values()) {
    if (!row.hasDex || row.liquidityUsd == null) continue;
    const liquidity = Number(row.liquidityUsd);
    if (!isFinite(liquidity)) continue;

    if (liquidity < threshold) {
      // Dropped back below — re-arm so a later crossing alerts again instead of staying silenced forever.
      alertTracker.clearAlert(chainKey, row.address, threshold);
      continue;
    }
    if (alertTracker.alreadyAlerted(chainKey, row.address, threshold)) continue;

    // Mark first so a slow/failed send can't fire twice for the same token/threshold
    // if two ticks overlap.
    alertTracker.markAlerted(chainKey, row.address, threshold);
    events.push({
      type: "threshold",
      chain: chainKey,
      address: row.address,
      title: "Trailhead: " + row.symbol + " crossed your threshold",
      body: row.symbol + " hit liquidity ≥ your threshold on " + CHAINS[chainKey].label + ".",
    });

    if (!webhookReady) continue; // browser-notification event still fired above; nothing more to do

    const payload = discord.buildLiquidityAlertPayload(row, CHAINS[chainKey], threshold);
    const result = await discord.postToWebhook(payload);
    if (result.ok) {
      status.alertsSent += 1;
      status.lastAlertAt = Date.now();
    } else {
      // Sending failed (Discord down, rate-limited, etc.) — allow a retry on the next tick
      // instead of silently losing the alert forever.
      alertTracker.clearAlert(chainKey, row.address, threshold);
      chainStatus.lastError = "Discord send failed: " + result.message;
    }
  }
}

/**
 * Checks every currently-watched token on this chain for a big 1h price move,
 * regardless of the liquidity threshold — this is a separate, browser-
 * notification-only signal (no Discord), deduped once per coin per hour.
 */
function checkWatchlistMoves(chainKey, byAddress) {
  const watched = watchlist.listForChain(chainKey);
  if (!watched.length) return;

  const notified = store.get("watchNotified", {});
  const hourBucket = Math.floor(Date.now() / 3600000);
  let changed = false;

  for (const w of watched) {
    const row = byAddress.get(w.address);
    if (!row || !row.hasDex || row.priceChangeH1 == null) continue;
    const h1 = Number(row.priceChangeH1);
    if (!isFinite(h1) || Math.abs(h1) < WATCH_MOVE_PCT) continue;

    const dedupeKey = `${chainKey}:${w.address}:${hourBucket}`;
    if (notified[dedupeKey]) continue;
    notified[dedupeKey] = Date.now();
    changed = true;

    const dir = h1 > 0 ? "up" : "down";
    events.push({
      type: "watch",
      chain: chainKey,
      address: w.address,
      title: "Trailhead watch: " + (row.symbol || w.symbol || "?"),
      body: (row.symbol || w.symbol || "?") + " is " + dir + " " + Math.abs(h1).toFixed(1) + "% in the last hour on " + CHAINS[chainKey].label + ".",
    });
  }

  if (changed) {
    // Prune old entries so this map doesn't grow forever on a long-running process.
    const cutoff = Date.now() - WATCH_NOTIFIED_MAX_AGE_MS;
    for (const k of Object.keys(notified)) {
      if (notified[k] < cutoff) delete notified[k];
    }
    store.set("watchNotified", notified);
  }
}

async function tick() {
  try {
    for (const chainKey of Object.keys(CHAINS)) {
      await checkChainThreshold(chainKey);
      await sleep(CHAIN_STAGGER_MS);
    }
    status.lastTickError = null;
  } catch (err) {
    // Belt-and-suspenders: even an unexpected bug here must not kill the interval loop.
    status.lastTickError = err && err.message ? err.message : String(err);
  } finally {
    status.lastTickAt = Date.now();
  }
}

let timer = null;

function start() {
  if (status.running) return;
  status.running = true;
  tick(); // kick off immediately, don't wait a full interval on boot
  timer = setInterval(tick, TICK_INTERVAL_MS);
}

function stop() {
  status.running = false;
  if (timer) clearInterval(timer);
  timer = null;
}

function getStatus() {
  const threshold = settings.getLiquidityThreshold();
  return {
    running: status.running,
    lastTickAt: status.lastTickAt,
    lastTickError: status.lastTickError,
    alertsSent: status.alertsSent,
    lastAlertAt: status.lastAlertAt,
    // Threshold detection (and browser-notification events) run whenever a threshold is set;
    // the Discord send additionally needs a webhook.
    alertingEnabled: threshold !== null,
    discordAlertsEnabled: threshold !== null && settings.isWebhookConfigured(),
    chains: status.chains,
  };
}

module.exports = { start, stop, getStatus };
