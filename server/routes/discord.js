"use strict";

const express = require("express");
const discord = require("../lib/discordClient");

const router = express.Router();

/**
 * Relay endpoint for the manual "Send to Discord" buttons (per coin / per NFT
 * / custom share). The frontend builds the embed content; the server is the
 * only thing that ever holds the webhook URL, so it attaches nothing more
 * than the message itself and posts it. `allowed_mentions` is always forced
 * to empty here — @everyone is reserved for the automatic liquidity alerts
 * in server/lib/monitor.js, never for a manual share.
 */
router.post("/relay", async (req, res) => {
  const body = req.body || {};
  if (!body.content && !(Array.isArray(body.embeds) && body.embeds.length)) {
    return res.status(400).json({ ok: false, message: "Nothing to send." });
  }
  const payload = {
    username: "Trailhead",
    content: typeof body.content === "string" ? body.content.slice(0, 1900) : undefined,
    embeds: Array.isArray(body.embeds) ? body.embeds.slice(0, 1) : undefined,
    allowed_mentions: { parse: [] },
  };
  const result = await discord.postToWebhook(payload);
  res.json(result);
});

module.exports = router;
