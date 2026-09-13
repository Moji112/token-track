"use strict";

const express = require("express");
const events = require("../lib/events");

const router = express.Router();

// Polled by the frontend to surface browser/OS notifications for threshold
// crossings and watchlist moves the background monitor already detected.
// `after` = last event id the client has seen; omit/0 to get nothing from
// before the poll started (a client passes its own "startup" id for that).
router.get("/since", (req, res) => {
  const after = Number(req.query.after) || 0;
  res.json({ ok: true, data: events.since(after), latestId: events.latestId() });
});

module.exports = router;
