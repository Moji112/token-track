"use strict";

const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "..", "data");
const FILE = path.join(DATA_DIR, "settings.json");

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function load() {
  ensureDir();
  try {
    const raw = fs.readFileSync(FILE, "utf8");
    return JSON.parse(raw);
  } catch (e) {
    return {};
  }
}

let cache = load();

function save() {
  ensureDir();
  const tmp = FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(cache, null, 2));
  fs.renameSync(tmp, FILE);
}

function get(key, fallback) {
  return Object.prototype.hasOwnProperty.call(cache, key) ? cache[key] : fallback;
}

function set(key, value) {
  cache[key] = value;
  save();
}

function del(key) {
  delete cache[key];
  save();
}

module.exports = { get, set, del };
