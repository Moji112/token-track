"use strict";

const express = require("express");
const { CHAINS } = require("../lib/chains");
const whaleCheck = require("../lib/whaleCheck");

const router = express.Router();

router.get("/:chain/:address", async (req, res) => {
  const { chain, address } = req.params;
  if (!CHAINS[chain]) return res.status(404).json({ status: "error", message: "Unknown chain." });
  const pairAddress = (req.query.pairAddress || "").toString();
  const result = await whaleCheck.runWhaleCheck(chain, address, pairAddress);
  res.json(result);
});

module.exports = router;
