"use strict";

const path = require("path");
const express = require("express");

const chainsRoute = require("./routes/chains");
const coinsRoute = require("./routes/coins");
const nftRoute = require("./routes/nft");
const settingsRoute = require("./routes/settings");
const discordRoute = require("./routes/discord");
const monitor = require("./lib/monitor");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: "256kb" }));

app.use("/api/chains", chainsRoute);
app.use("/api/coins", coinsRoute);
app.use("/api/nft", nftRoute);
app.use("/api/settings", settingsRoute);
app.use("/api/discord", discordRoute);

app.use(express.static(path.join(__dirname, "..", "public")));

// Belt-and-suspenders: an uncaught error in any route must return a clean
// response, never crash the process or take down other in-flight requests.
app.use((err, req, res, next) => {
  console.error("[unhandled route error]", err);
  if (res.headersSent) return next(err);
  res.status(500).json({ ok: false, message: "Something went wrong on the server." });
});

process.on("unhandledRejection", (err) => {
  console.error("[unhandled rejection]", err);
});
process.on("uncaughtException", (err) => {
  console.error("[uncaught exception]", err);
});

app.listen(PORT, () => {
  console.log(`Trailhead running at http://localhost:${PORT}`);
  monitor.start();
});
