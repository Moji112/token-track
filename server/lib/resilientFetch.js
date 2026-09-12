"use strict";

/**
 * A fetch wrapper built for flaky third-party APIs (DexScreener, per-chain
 * Blockscout instances, Discord webhooks): request timeouts, bounded retries
 * with exponential backoff, and explicit handling of rate limits (429) and
 * transient 5xx errors. It never lets a single bad request take down the
 * caller — it either returns a Response or throws a normalized Error with a
 * `.status`/`.code` the rest of the app can branch on.
 */

const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_RETRIES = 2;
const DEFAULT_BACKOFF_MS = 400;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableStatus(status) {
  return status === 429 || status === 502 || status === 503 || status === 504;
}

function normalizeError(err) {
  if (!err) return new Error("Unknown network error");
  if (err.name === "AbortError") {
    const e = new Error("Request timed out");
    e.code = "ETIMEDOUT";
    return e;
  }
  return err;
}

/**
 * Fetch with timeout + retry/backoff. Resolves to a Response for any
 * response the server actually sent (including non-2xx that isn't
 * retryable) so callers can inspect status. Only throws when every attempt
 * failed to get a response at all (timeout / DNS / connection reset / etc.)
 * or every retryable-status attempt was exhausted.
 */
async function resilientFetch(url, opts = {}) {
  const {
    timeoutMs = DEFAULT_TIMEOUT_MS,
    retries = DEFAULT_RETRIES,
    backoffMs = DEFAULT_BACKOFF_MS,
    method = "GET",
    headers = {},
    body,
  } = opts;

  let lastErr;
  let lastRes;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method,
        headers: { Accept: "application/json", ...headers },
        body,
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (isRetryableStatus(res.status) && attempt < retries) {
        lastRes = res;
        const retryAfterHeader = Number(res.headers.get("retry-after"));
        const wait = retryAfterHeader
          ? retryAfterHeader * 1000
          : backoffMs * Math.pow(2, attempt);
        await sleep(Math.min(wait, 15000));
        continue;
      }
      return res;
    } catch (err) {
      clearTimeout(timer);
      lastErr = err;
      if (attempt < retries) {
        await sleep(backoffMs * Math.pow(2, attempt));
        continue;
      }
    }
  }

  if (lastRes) return lastRes;
  throw normalizeError(lastErr);
}

/**
 * Same as resilientFetch, but parses JSON and throws a normalized error
 * (with `.status` set) for non-2xx responses or malformed/incomplete JSON
 * bodies, instead of returning garbage to the caller.
 */
async function resilientFetchJSON(url, opts) {
  const res = await resilientFetch(url, opts);
  if (!res.ok) {
    const err = new Error("HTTP " + res.status);
    err.status = res.status;
    throw err;
  }
  let text;
  try {
    text = await res.text();
  } catch (e) {
    const err = new Error("Failed to read response body");
    err.status = res.status;
    throw err;
  }
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (e) {
    const err = new Error("Invalid JSON response");
    err.status = res.status;
    throw err;
  }
}

module.exports = { resilientFetch, resilientFetchJSON, sleep };
