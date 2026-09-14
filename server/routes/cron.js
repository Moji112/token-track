"use strict";

const express = require("express");
const monitor = require("../lib/monitor");

const router = express.Router();

/**
 * Called by Vercel Cron (a plain GET request) since there's no persistent
 * process there to run the monitor's own setInterval loop. Runs exactly one
 * check cycle across all chains and returns.
 *
 * Protected by CRON_SECRET: when that environment variable is set, Vercel
 * automatically sends it as `Authorization: Bearer <CRON_SECRET>` on cron
 * invocations, so anyone else hitting this path without it gets rejected.
 * If CRON_SECRET isn't set, this is intentionally left reachable (so it also
 * works with no extra setup outside Vercel, e.g. a manual health-check curl
 * or a different scheduler), but you should set one on a public deployment.
 */
router.get("/tick", async (req, res) => {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const header = req.headers.authorization || "";
    if (header !== `Bearer ${secret}`) {
      return res.status(401).json({ ok: false, message: "Unauthorized." });
    }
  }
  try {
    await monitor.tick();
    res.json({ ok: true, status: monitor.getStatus() });
  } catch (err) {
    console.error("[cron tick]", err);
    res.status(500).json({ ok: false, message: "Cron tick failed." });
  }
});

module.exports = router;
