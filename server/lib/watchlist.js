"use strict";

const store = require("./store");
const { CHAINS, normalizeAddress } = require("./chains");

const KEY = "watchlist";
const DEFAULT_KIND = "coin"; // existing coin watchlist entries predate the "kind" field — treat unmarked ones as coins

function keyFor(kind, chain, address) {
  return `${kind}:${chain}:${normalizeAddress(chain, address)}`;
}

function getAll() {
  return store.get(KEY, {});
}

function list(kind) {
  const all = getAll();
  return Object.keys(all)
    .map((k) => all[k])
    .filter((w) => (w.kind || DEFAULT_KIND) === (kind || DEFAULT_KIND));
}

function listForChain(chainKey, kind) {
  return list(kind).filter((w) => w.chain === chainKey);
}

function isWatched(chain, address, kind) {
  const all = getAll();
  return !!all[keyFor(kind || DEFAULT_KIND, chain, address)];
}

function add(chain, address, meta, kind) {
  if (!CHAINS[chain]) {
    const err = new Error("Unknown chain.");
    err.status = 400;
    throw err;
  }
  const addr = normalizeAddress(chain, address);
  if (!addr) {
    const err = new Error("Missing address.");
    err.status = 400;
    throw err;
  }
  const resolvedKind = kind || DEFAULT_KIND;
  const all = getAll();
  const k = keyFor(resolvedKind, chain, addr);
  all[k] = {
    kind: resolvedKind,
    chain,
    address: addr,
    symbol: (meta && meta.symbol) || "?",
    name: (meta && meta.name) || "",
    addedAt: (all[k] && all[k].addedAt) || Date.now(),
  };
  store.set(KEY, all);
  return all[k];
}

function remove(chain, address, kind) {
  const all = getAll();
  const k = keyFor(kind || DEFAULT_KIND, chain, address);
  const existed = !!all[k];
  delete all[k];
  store.set(KEY, all);
  return existed;
}

module.exports = { list, listForChain, isWatched, add, remove };
