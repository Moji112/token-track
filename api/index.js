"use strict";

// Vercel serverless entry point. Exports the Express app directly — Vercel's
// Node runtime accepts any (req, res) handler, and an Express app is exactly
// that. Deliberately does NOT call app.listen() or start the background
// monitor: Vercel functions don't stay alive between requests, so a
// setInterval loop here would not reliably keep running. See README.md
// ("Deploying") for what that means for automatic Discord alerts on Vercel.

module.exports = require("../server/app");
