"use strict";

const crypto = require("crypto");

/**
 * Optional password protection for the whole app (UI + API), via HTTP Basic
 * Auth. Enabled by setting TRAILHEAD_PASSWORD in the environment — never
 * hardcoded here. If it isn't set, the app runs unprotected (useful for
 * local development) and prints a warning on startup so that's never a
 * silent surprise.
 *
 * Username is not checked — only the password — so any username works in
 * the browser's login prompt.
 */

function sha256(value) {
  return crypto.createHash("sha256").update(String(value), "utf8").digest();
}

/** Fixed-length-hash comparison so neither a length nor a byte-by-byte timing difference leaks anything. */
function safeEqual(a, b) {
  return crypto.timingSafeEqual(sha256(a), sha256(b));
}

function isEnabled() {
  return !!process.env.TRAILHEAD_PASSWORD;
}

function basicAuth(req, res, next) {
  const expected = process.env.TRAILHEAD_PASSWORD;
  if (!expected) return next(); // password protection is off

  const header = req.headers.authorization || "";
  const match = /^Basic\s+(.+)$/i.exec(header);
  if (match) {
    let decoded = "";
    try {
      decoded = Buffer.from(match[1], "base64").toString("utf8");
    } catch (e) {
      decoded = "";
    }
    const sep = decoded.indexOf(":");
    const password = sep >= 0 ? decoded.slice(sep + 1) : decoded;
    if (password && safeEqual(password, expected)) return next();
  }

  res.set("WWW-Authenticate", 'Basic realm="Trailhead", charset="UTF-8"');
  res.status(401).send("Authentication required.");
}

module.exports = { basicAuth, isEnabled };
