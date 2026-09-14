"use strict";

const express = require("express");
const settings = require("../lib/settingsService");
const discord = require("../lib/discordClient");
const monitor = require("../lib/monitor");

const router = express.Router();

function publicSettings() {
  return {
    liquidityThreshold: settings.getLiquidityThreshold(),
    webhookConfigured: settings.isWebhookConfigured(),
    envManaged: settings.isEnvManaged(),
    monitor: monitor.getStatus(),
  };
}

router.get("/", (req, res) => {
  res.json({ ok: true, data: publicSettings() });
});

router.put("/threshold", (req, res) => {
  try {
    const value = settings.setLiquidityThreshold(req.body ? req.body.value : undefined);
    res.json({ ok: true, data: { liquidityThreshold: value } });
  } catch (err) {
    res.status(err.status || 400).json({ ok: false, message: err.message });
  }
});

router.put("/webhook", (req, res) => {
  try {
    const url = settings.setWebhookUrl(req.body ? req.body.url : "");
    res.json({ ok: true, data: { webhookConfigured: !!url } });
  } catch (err) {
    res.status(err.status || 400).json({ ok: false, message: err.message });
  }
});

router.delete("/webhook", (req, res) => {
  try {
    settings.clearWebhookUrl();
    res.json({ ok: true, data: { webhookConfigured: false } });
  } catch (err) {
    res.status(err.status || 400).json({ ok: false, message: err.message });
  }
});

router.post("/webhook/test", async (req, res) => {
  const result = await discord.postToWebhook({
    username: "Trailhead",
    content: "👋 Connected — you'll get liquidity alerts from Trailhead here.",
  });
  res.json(result);
});

module.exports = router;
