"use strict";

/**
 * Stale-while-error cache for upstream data (Blockscout / DexScreener
 * composed rows). This is what keeps already-loaded data on screen when a
 * refresh temporarily fails, and what stops one failed request from
 * clearing an entire list:
 *
 *  - Fresh data within `ttlMs`: return it immediately, no network call.
 *  - Expired but a fetch fails: fall back to the last known-good data and
 *    mark the result `stale: true` with a human `warning`, instead of
 *    throwing the error up to the route.
 *  - No known-good data has ever been fetched for this key: the error
 *    propagates once, so the route can return a clean "still loading"
 *    fallback rather than a raw failure.
 */

const store = new Map(); // key -> { data, updatedAt, inFlight }

function describeError(err) {
  if (!err) return "Temporarily unreachable — showing the last data we had.";
  if (err.status === 429) return "Rate-limited right now — showing the last data we had.";
  if (err.code === "ETIMEDOUT") return "That request timed out — showing the last data we had.";
  if (err.status >= 500) return "The upstream service is having trouble — showing the last data we had.";
  return "Temporarily unreachable — showing the last data we had.";
}

async function cached(key, fetcher, opts = {}) {
  const ttlMs = opts.ttlMs || 20000;
  const entry = store.get(key);
  const now = Date.now();

  if (entry && now - entry.updatedAt < ttlMs) {
    return { data: entry.data, stale: false, updatedAt: entry.updatedAt, warning: null };
  }

  // Coalesce concurrent refreshes of the same key into one upstream call.
  if (entry && entry.inFlight) {
    try {
      const data = await entry.inFlight;
      const fresh = store.get(key);
      return { data, stale: false, updatedAt: fresh ? fresh.updatedAt : now, warning: null };
    } catch (err) {
      if (entry.data !== undefined) {
        return { data: entry.data, stale: true, updatedAt: entry.updatedAt, warning: describeError(err) };
      }
      throw err;
    }
  }

  const promise = Promise.resolve().then(fetcher);
  store.set(key, { ...(entry || {}), inFlight: promise, data: entry ? entry.data : undefined, updatedAt: entry ? entry.updatedAt : 0 });

  try {
    const data = await promise;
    store.set(key, { data, updatedAt: Date.now(), inFlight: null });
    return { data, stale: false, updatedAt: Date.now(), warning: null };
  } catch (err) {
    if (entry && entry.data !== undefined) {
      store.set(key, { data: entry.data, updatedAt: entry.updatedAt, inFlight: null });
      return { data: entry.data, stale: true, updatedAt: entry.updatedAt, warning: describeError(err) };
    }
    store.set(key, { data: undefined, updatedAt: 0, inFlight: null });
    throw err;
  }
}

function peek(key) {
  const entry = store.get(key);
  if (!entry || entry.data === undefined) return null;
  return { data: entry.data, updatedAt: entry.updatedAt };
}

module.exports = { cached, peek, describeError };
