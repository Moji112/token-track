"use strict";

const fs = require("fs");
const path = require("path");

// On a normal persistent host (local, Railway, Render) this lives in the
// project's own data/ folder. On Vercel, the deployment bundle is read-only
// outside of /tmp, so we write there instead — it won't survive a cold
// start or a redeploy (see README.md), but it also won't crash every save.
const DATA_DIR = process.env.VERCEL
  ? path.join("/tmp", "trailhead-data")
  : path.join(__dirname, "..", "..", "data");
const FILE = path.join(DATA_DIR, "settings.json");

let warnedReadOnly = false;
function warnOnce(action, err) {
  if (warnedReadOnly) return;
  warnedReadOnly = true;
  console.warn(`[store] Couldn't ${action} ${FILE} — continuing with in-memory settings only.`, err && err.message);
}

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function load() {
  try {
    ensureDir();
    const raw = fs.readFileSync(FILE, "utf8");
    return JSON.parse(raw);
  } catch (e) {
    return {};
  }
}

let cache = load();

function save() {
  // A failed write (read-only filesystem, out of space, etc.) must never
  // crash the request that triggered it — the in-memory `cache` still has
  // the new value, it just won't be there on the next process restart.
  try {
    ensureDir();
    const tmp = FILE + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(cache, null, 2));
    fs.renameSync(tmp, FILE);
  } catch (e) {
    warnOnce("write to", e);
  }
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
