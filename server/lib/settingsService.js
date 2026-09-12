"use strict";

const store = require("./store");

const WEBHOOK_RE = /^https:\/\/(discord\.com|discordapp\.com|canary\.discord\.com|ptb\.discord\.com)\/api\/webhooks\/\d+\/[\w-]+\/?$/i;

/** Liquidity threshold in USD. `null` means alerts are off until the user sets one — never a hardcoded default. */
function getLiquidityThreshold() {
  const v = store.get("liquidityThreshold", null);
  return v === null || v === undefined ? null : Number(v);
}

function setLiquidityThreshold(value) {
  if (value === null || value === "" || value === undefined) {
    store.del("liquidityThreshold");
    return null;
  }
  const n = Number(value);
  if (!isFinite(n) || n < 0) {
    const err = new Error("Liquidity threshold must be a non-negative number.");
    err.status = 400;
    throw err;
  }
  store.set("liquidityThreshold", n);
  return n;
}

function getWebhookUrl() {
  return store.get("webhookUrl", "") || "";
}

function isWebhookConfigured() {
  return !!getWebhookUrl();
}

function setWebhookUrl(url) {
  const val = (url || "").trim();
  if (val && !WEBHOOK_RE.test(val)) {
    const err = new Error(
      "That doesn't look like a Discord webhook URL (should start with https://discord.com/api/webhooks/…)."
    );
    err.status = 400;
    throw err;
  }
  if (!val) {
    store.del("webhookUrl");
    return "";
  }
  store.set("webhookUrl", val);
  return val;
}

function clearWebhookUrl() {
  store.del("webhookUrl");
}

module.exports = {
  getLiquidityThreshold,
  setLiquidityThreshold,
  getWebhookUrl,
  isWebhookConfigured,
  setWebhookUrl,
  clearWebhookUrl,
  WEBHOOK_RE,
};
