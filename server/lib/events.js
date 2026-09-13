"use strict";

/**
 * A small in-memory ring buffer of "things the monitor noticed" — liquidity
 * threshold crossings and watchlist price moves. The Discord side effect
 * happens directly where these are detected (server/lib/monitor.js); this
 * feed exists purely so a browser tab that's currently open can poll for
 * "anything new since last time I asked" and turn it into a native OS
 * notification via the Notification API, which only a page context can do.
 *
 * Deliberately not persisted to disk: it's just a delivery hint for tabs
 * that happen to be open right now, not a source of truth (Discord alerts
 * and the threshold/watchlist dedupe state are the source of truth, and
 * those ARE persisted).
 */

const MAX_EVENTS = 200;
let events = [];
let nextId = 1;

function push(event) {
  const record = { id: nextId++, ts: Date.now(), ...event };
  events.push(record);
  if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS);
  return record;
}

/** Returns events with id > afterId (0 = "everything currently buffered"). */
function since(afterId) {
  const after = Number(afterId) || 0;
  return events.filter((e) => e.id > after);
}

function latestId() {
  return events.length ? events[events.length - 1].id : 0;
}

module.exports = { push, since, latestId };
