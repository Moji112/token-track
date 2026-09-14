"use strict";

const express = require("express");
const { CHAINS, NFT_INFO } = require("../lib/chains");

const router = express.Router();

router.get("/", (req, res) => {
  const list = Object.keys(CHAINS).map((key) => {
    const c = CHAINS[key];
    return {
      key: c.key,
      label: c.label,
      explorerLabel: c.explorerLabel,
      note: c.note,
      warn: c.warn || null,
      nft: NFT_INFO[key] || { body: "", links: [] },
      // Client-side gates (e.g. hiding "Most held"/whale-check for a non-Blockscout chain like
      // Solana) need this — it was missing before, so those checks always silently defaulted wrong.
      supportsBlockscout: c.supportsBlockscout !== false,
      isEvm: c.isEvm !== false,
    };
  });
  res.json({ ok: true, data: list });
});

module.exports = router;
