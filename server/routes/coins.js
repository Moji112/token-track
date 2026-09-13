"use strict";

const express = require("express");
const { CHAINS } = require("../lib/chains");
const coinsData = require("../lib/coinsData");

const router = express.Router();
const VALID_FEEDS = new Set(["mostheld", "new", "boosted", "watch"]);

function requireChain(req, res, next) {
  if (!CHAINS[req.params.chain]) {
    return res.status(404).json({ ok: false, data: [], message: "Unknown chain." });
  }
  next();
}

router.get("/:chain/search", requireChain, async (req, res) => {
  const q = (req.query.q || "").toString().trim();
  if (!q) return res.json({ ok: true, data: [], stale: false, updatedAt: Date.now(), warning: null });
  try {
    const rows = await coinsData.runSearch(q, req.params.chain);
    res.json({ ok: true, data: rows, stale: false, updatedAt: Date.now(), warning: null });
  } catch (err) {
    // A failed search should never look like a crash — just "nothing yet, try again".
    res.json({
      ok: false,
      data: [],
      stale: false,
      updatedAt: null,
      message: "Search is temporarily unavailable — DexScreener may be busy. Try again in a moment.",
    });
  }
});

router.get("/:chain/:feed", requireChain, async (req, res) => {
  const { chain, feed } = req.params;
  if (!VALID_FEEDS.has(feed)) {
    return res.status(404).json({ ok: false, data: [], message: "Unknown feed." });
  }
  try {
    const result = await coinsData.getRows(chain, feed);
    res.json({ ok: true, data: result.data, stale: result.stale, updatedAt: result.updatedAt, warning: result.warning });
  } catch (err) {
    // Never surface a raw failure / never crash — hand back a clean, retryable empty state
    // and let the frontend keep polling until data shows up.
    res.json({
      ok: false,
      data: [],
      stale: false,
      updatedAt: null,
      message: "Live data hasn't loaded yet — this chain's explorer or DexScreener may be busy. Retrying automatically.",
    });
  }
});

module.exports = router;
