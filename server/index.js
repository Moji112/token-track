"use strict";

// Entry point for a real, persistent process: local dev, Railway, Render, a
// VPS, etc. This is what starts the background liquidity monitor — it needs
// a process that stays alive, which is exactly what this file assumes.
// (Vercel's serverless functions don't stay alive between requests, so its
// entry point is api/index.js instead, and it does NOT start the monitor.)

const app = require("./app");
const auth = require("./lib/auth");
const monitor = require("./lib/monitor");

const PORT = process.env.PORT || 3000;

process.on("unhandledRejection", (err) => {
  console.error("[unhandled rejection]", err);
});
process.on("uncaughtException", (err) => {
  console.error("[uncaught exception]", err);
});

app.listen(PORT, () => {
  console.log(`Trailhead running at http://localhost:${PORT}`);
  console.log(
    auth.isEnabled()
      ? "Password protection: ON (TRAILHEAD_PASSWORD is set)"
      : "Password protection: OFF — set TRAILHEAD_PASSWORD in the environment to require a password."
  );
  monitor.start();
});
