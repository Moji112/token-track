"use strict";

// The Express app itself — no app.listen(), no background monitor. Shared by
// both entry points: server/index.js (a real persistent process, for local
// dev / Railway / Render) and api/index.js (a Vercel serverless function,
// which must export a request handler instead of starting a server).

const path = require("path");
const express = require("express");

const chainsRoute = require("./routes/chains");
const coinsRoute = require("./routes/coins");
const nftRoute = require("./routes/nft");
const settingsRoute = require("./routes/settings");
const discordRoute = require("./routes/discord");
const watchlistRoute = require("./routes/watchlist");
const eventsRoute = require("./routes/events");
const whaleRoute = require("./routes/whale");
const cronRoute = require("./routes/cron");
const auth = require("./lib/auth");

const app = express();

// Body parsing has to come before the auth gate — the login endpoint needs
// req.body, and it's one of the two paths the gate lets through unauthenticated.
app.use(express.json({ limit: "256kb" }));

// Password gate for the whole app (UI + API) — set TRAILHEAD_PASSWORD to enable.
app.use(auth.gate);
app.post("/api/auth/login", auth.login);
app.post("/api/auth/logout", auth.logout);

app.use("/api/chains", chainsRoute);
app.use("/api/coins", coinsRoute);
app.use("/api/nft", nftRoute);
app.use("/api/settings", settingsRoute);
app.use("/api/discord", discordRoute);
app.use("/api/watchlist", watchlistRoute);
app.use("/api/events", eventsRoute);
app.use("/api/whale", whaleRoute);
app.use("/api/cron", cronRoute);

// Named "webapp", not "public" — Vercel treats a top-level "public/" folder as
// its implicit static-asset output and serves it directly, bypassing this
// Express app (and therefore the auth gate above) entirely. A differently
// named folder forces every request through this app, gate included.
app.use(express.static(path.join(__dirname, "..", "webapp")));

// Belt-and-suspenders: an uncaught error in any route must return a clean
// response, never crash the process or take down other in-flight requests.
app.use((err, req, res, next) => {
  console.error("[unhandled route error]", err);
  if (res.headersSent) return next(err);
  res.status(500).json({ ok: false, message: "Something went wrong on the server." });
});

module.exports = app;
