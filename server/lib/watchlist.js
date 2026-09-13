"use strict";

const store = require("./store");
const { CHAINS, normalizeAddress } = require("./chains");

const KEY = "watchlist";

function keyFor(chain, address) {
  return `${chain}:${normalizeAddress(chain, address)}`;
}

function getAll() {
  return store.get(KEY, {});
}

function list() {
  const all = getAll();
  return Object.keys(all).map((k) => all[k]);
}

function listForChain(chainKey) {
  return list().filter((w) => w.chain === chainKey);
}

function isWatched(chain, address) {
  const all = getAll();
  return !!all[keyFor(chain, address)];
}

function add(chain, address, meta) {
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
  const all = getAll();
  const k = keyFor(chain, addr);
  all[k] = {
    chain,
    address: addr,
    symbol: (meta && meta.symbol) || "?",
    name: (meta && meta.name) || "",
    addedAt: (all[k] && all[k].addedAt) || Date.now(),
  };
  store.set(KEY, all);
  return all[k];
}

function remove(chain, address) {
  const all = getAll();
  const k = keyFor(chain, address);
  const existed = !!all[k];
  delete all[k];
  store.set(KEY, all);
  return existed;
}

module.exports = { list, listForChain, isWatched, add, remove };
