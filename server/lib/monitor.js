"use strict";

const { CHAINS } = require("./chains");
const coinsData = require("./coinsData");
const settings = require("./settingsService");
const alertTracker = require("./alertTracker");
const discord = require("./discordClient");

const TICK_INTERVAL_MS = 30000;
const CHAIN_STAGGER_MS = 2000;
const FEEDS = ["mostheld", "new", "boosted"];

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

async function checkChain(chainKey) {
  const chainStatus = (status.chains[chainKey] = status.chains[chainKey] || {});
  const threshold = settings.getLiquidityThreshold();
  const webhookReady = settings.isWebhookConfigured();
  const byAddress = new Map();

  for (const feed of FEEDS) {
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

  if (threshold === null || !webhookReady) return; // alerting disabled until both are configured

  for (const row of byAddress.values()) {
    if (!row.hasDex || row.liquidityUsd == null) continue;
    const liquidity = Number(row.liquidityUsd);
    if (!isFinite(liquidity) || liquidity < threshold) continue;
    if (alertTracker.alreadyAlerted(chainKey, row.address, threshold)) continue;

    // Mark first so a slow/failed send can't fire twice for the same token/threshold
    // if two ticks overlap.
    alertTracker.markAlerted(chainKey, row.address, threshold);
    const payload = discord.buildLiquidityAlertPayload(row, CHAINS[chainKey], threshold);
    const result = await discord.postToWebhook(payload);
    if (result.ok) {
      status.alertsSent += 1;
      status.lastAlertAt = Date.now();
    } else {
      // Sending failed (Discord down, rate-limited, etc.) — allow a retry on the next tick
      // instead of silently losing the alert forever.
      undoAlertMark(chainKey, row.address, threshold);
      chainStatus.lastError = "Discord send failed: " + result.message;
    }
  }
}

function undoAlertMark(chainKey, address, threshold) {
  // alertTracker only exposes mark/check; a small internal-only unmark keeps this file's
  // retry logic self-contained without growing alertTracker's public surface.
  try {
    const store = require("./store");
    const alerted = store.get("alertedLiquidity", {});
    delete alerted[`${chainKey}:${address.toLowerCase()}:${threshold}`];
    store.set("alertedLiquidity", alerted);
  } catch (e) {
    /* best-effort */
  }
}

async function tick() {
  try {
    for (const chainKey of Object.keys(CHAINS)) {
      await checkChain(chainKey);
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
  return {
    running: status.running,
    lastTickAt: status.lastTickAt,
    lastTickError: status.lastTickError,
    alertsSent: status.alertsSent,
    lastAlertAt: status.lastAlertAt,
    alertingEnabled: settings.getLiquidityThreshold() !== null && settings.isWebhookConfigured(),
    chains: status.chains,
  };
}

module.exports = { start, stop, getStatus };
