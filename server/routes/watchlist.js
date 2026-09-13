"use strict";

const express = require("express");
const watchlist = require("../lib/watchlist");

const router = express.Router();

router.get("/", (req, res) => {
  res.json({ ok: true, data: watchlist.list() });
});

router.post("/", (req, res) => {
  const body = req.body || {};
  try {
    const entry = watchlist.add(body.chain, body.address, { symbol: body.symbol, name: body.name });
    res.json({ ok: true, data: entry });
  } catch (err) {
    res.status(err.status || 400).json({ ok: false, message: err.message });
  }
});

router.delete("/:chain/:address", (req, res) => {
  watchlist.remove(req.params.chain, req.params.address);
  res.json({ ok: true });
});

module.exports = router;
