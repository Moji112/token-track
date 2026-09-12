"use strict";

const store = require("./store");

/**
 * Dedupes liquidity alerts by chain+address+threshold, persisted to disk so
 * a restart doesn't re-fire the same alert. Keying on the threshold too
 * means changing the threshold naturally opens up fresh alerts for that new
 * value without needing an explicit reset, while never re-sending for a
 * token/threshold pair that already fired.
 */

function keyFor(chain, address, threshold) {
  return `${chain}:${address.toLowerCase()}:${threshold}`;
}

function alreadyAlerted(chain, address, threshold) {
  const alerted = store.get("alertedLiquidity", {});
  return !!alerted[keyFor(chain, address, threshold)];
}

function markAlerted(chain, address, threshold) {
  const alerted = store.get("alertedLiquidity", {});
  alerted[keyFor(chain, address, threshold)] = Date.now();
  store.set("alertedLiquidity", alerted);
}

module.exports = { alreadyAlerted, markAlerted };
