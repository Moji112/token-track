"use strict";

const express = require("express");
const { CHAINS } = require("../lib/chains");
const nftData = require("../lib/nftData");

const router = express.Router();
const VALID_FEEDS = new Set(["mostheld", "new", "watch"]);

function requireChain(req, res, next) {
  if (!CHAINS[req.params.chain]) {
    return res.status(404).json({ ok: false, data: [], message: "Unknown chain." });
  }
  next();
}

router.get("/:chain/:address/instances", requireChain, async (req, res) => {
  try {
    const items = await nftData.getNftInstances(req.params.chain, req.params.address);
    res.json({ ok: true, data: items.slice(0, 6) });
  } catch (err) {
    res.json({ ok: false, data: [], message: "Couldn't load a preview right now." });
  }
});

router.get("/:chain/:feed", requireChain, async (req, res) => {
  const { chain, feed } = req.params;
  if (!VALID_FEEDS.has(feed)) {
    return res.status(404).json({ ok: false, data: [], message: "Unknown feed." });
  }
  try {
    const result = await nftData.getNftFeed(chain, feed);
    res.json({ ok: true, data: result.data, stale: result.stale, updatedAt: result.updatedAt, warning: result.warning });
  } catch (err) {
    res.json({
      ok: false,
      data: [],
      stale: false,
      updatedAt: null,
      message: "Couldn't load NFT contracts yet — the explorer may be busy. Retrying automatically.",
    });
  }
});

router.get("/:chain", requireChain, async (req, res) => {
  try {
    const result = await nftData.getNftFeed(req.params.chain, "mostheld");
    res.json({ ok: true, data: result.data, stale: result.stale, updatedAt: result.updatedAt, warning: result.warning });
  } catch (err) {
    res.json({
      ok: false,
      data: [],
      stale: false,
      updatedAt: null,
      message: "Couldn't load NFT contracts yet — the explorer may be busy. Retrying automatically.",
    });
  }
});

module.exports = router;
