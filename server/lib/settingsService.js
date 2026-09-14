"use strict";

const store = require("./store");

const WEBHOOK_RE = /^https:\/\/(discord\.com|discordapp\.com|canary\.discord\.com|ptb\.discord\.com)\/api\/webhooks\/\d+\/[\w-]+\/?$/i;

/**
 * On a persistent host, data/settings.json is the source of truth. On Vercel
 * it lives in /tmp, which is NOT shared between separate invocations — a
 * cron-triggered check runs as its own invocation and would see none of what
 * was saved through the UI from a browser request. TRAILHEAD_LIQUIDITY_THRESHOLD
 * / TRAILHEAD_WEBHOOK_URL environment variables, when set, win over the file
 * store for exactly this reason: they're the same for every invocation. Set
 * them in Vercel's dashboard instead of using the in-app Settings UI there.
 */
function envThreshold() {
  const raw = process.env.TRAILHEAD_LIQUIDITY_THRESHOLD;
  if (raw === undefined || raw === "") return undefined;
  const n = Number(raw);
  return isFinite(n) && n >= 0 ? n : undefined;
}

function envWebhookUrl() {
  const raw = process.env.TRAILHEAD_WEBHOOK_URL;
  return raw && WEBHOOK_RE.test(raw) ? raw : undefined;
}

/** Liquidity threshold in USD. `null` means alerts are off until one is set — never a hardcoded default. */
function getLiquidityThreshold() {
  const fromEnv = envThreshold();
  if (fromEnv !== undefined) return fromEnv;
  const v = store.get("liquidityThreshold", null);
  return v === null || v === undefined ? null : Number(v);
}

function setLiquidityThreshold(value) {
  if (envThreshold() !== undefined) {
    const err = new Error("Liquidity threshold is set via the TRAILHEAD_LIQUIDITY_THRESHOLD environment variable on this deployment — change it there instead.");
    err.status = 409;
    throw err;
  }
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
  const fromEnv = envWebhookUrl();
  if (fromEnv !== undefined) return fromEnv;
  return store.get("webhookUrl", "") || "";
}

function isWebhookConfigured() {
  return !!getWebhookUrl();
}

/** True when the webhook/threshold come from the environment and can't be changed via the UI on this deployment. */
function isEnvManaged() {
  return envThreshold() !== undefined || envWebhookUrl() !== undefined;
}

function setWebhookUrl(url) {
  if (envWebhookUrl() !== undefined) {
    const err = new Error("The webhook is set via the TRAILHEAD_WEBHOOK_URL environment variable on this deployment — change it there instead.");
    err.status = 409;
    throw err;
  }
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
  if (envWebhookUrl() !== undefined) {
    const err = new Error("The webhook is set via the TRAILHEAD_WEBHOOK_URL environment variable on this deployment — remove it there instead.");
    err.status = 409;
    throw err;
  }
  store.del("webhookUrl");
}

module.exports = {
  getLiquidityThreshold,
  setLiquidityThreshold,
  getWebhookUrl,
  isWebhookConfigured,
  setWebhookUrl,
  clearWebhookUrl,
  isEnvManaged,
  WEBHOOK_RE,
};
