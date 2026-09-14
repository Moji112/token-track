"use strict";

const crypto = require("crypto");

/**
 * Optional password protection for the whole app (UI + API): a small custom
 * login page (password only, no username) that sets a signed session cookie
 * on success. Enabled by setting TRAILHEAD_PASSWORD in the environment —
 * never hardcoded here. If it isn't set, the app runs unprotected (useful
 * for local development) and prints a warning on startup so that's never a
 * silent surprise.
 *
 * The session token is signed with a key derived from the password itself,
 * so there's no separate secret to configure — changing the password also
 * invalidates every existing session. No session state is kept on the
 * server (works fine across Vercel's stateless serverless invocations).
 */

const COOKIE_NAME = "trailhead_session";
const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

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

function signingKey() {
  return crypto.createHash("sha256").update("trailhead-session:" + (process.env.TRAILHEAD_PASSWORD || ""), "utf8").digest();
}

function createSessionToken() {
  const payload = JSON.stringify({ exp: Date.now() + SESSION_MAX_AGE_MS });
  const b64 = Buffer.from(payload, "utf8").toString("base64url");
  const sig = crypto.createHmac("sha256", signingKey()).update(b64).digest("base64url");
  return b64 + "." + sig;
}

function verifySessionToken(token) {
  if (!token || typeof token !== "string") return false;
  const parts = token.split(".");
  if (parts.length !== 2) return false;
  const [b64, sig] = parts;
  let sigBuf, expectedBuf;
  try {
    sigBuf = Buffer.from(sig, "base64url");
    expectedBuf = Buffer.from(crypto.createHmac("sha256", signingKey()).update(b64).digest("base64url"), "base64url");
  } catch (e) {
    return false;
  }
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) return false;
  try {
    const payload = JSON.parse(Buffer.from(b64, "base64url").toString("utf8"));
    return typeof payload.exp === "number" && payload.exp > Date.now();
  } catch (e) {
    return false;
  }
}

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  header.split(";").forEach((part) => {
    const idx = part.indexOf("=");
    if (idx === -1) return;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) {
      try {
        out[k] = decodeURIComponent(v);
      } catch (e) {
        out[k] = v;
      }
    }
  });
  return out;
}

function hasValidSession(req) {
  const cookies = parseCookies(req.headers.cookie);
  return verifySessionToken(cookies[COOKIE_NAME]);
}

function setSessionCookie(res) {
  const token = createSessionToken();
  const parts = [
    `${COOKIE_NAME}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${Math.floor(SESSION_MAX_AGE_MS / 1000)}`,
  ];
  if (process.env.VERCEL || process.env.NODE_ENV === "production") parts.push("Secure");
  res.setHeader("Set-Cookie", parts.join("; "));
}

function clearSessionCookie(res) {
  res.setHeader("Set-Cookie", `${COOKIE_NAME}=; Path=/; HttpOnly; Max-Age=0`);
}

const LOGIN_PAGE_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Trailhead</title>
<style>
  :root{ --paper:#EFF2EA; --card:#FFFFFF; --text:#171B16; --text-muted:#5B6259; --border:#D8DECB; --neg:#B33F2E; --focus:#3A5AE8; }
  *{ box-sizing:border-box; }
  html,body{ height:100%; }
  body{
    margin:0; display:flex; align-items:center; justify-content:center;
    font-family:'Schibsted Grotesk', system-ui, -apple-system, sans-serif;
    background:var(--paper); color:var(--text);
  }
  form{
    background:var(--card); border:1px solid var(--border); border-radius:12px;
    padding:28px; width:100%; max-width:300px; box-shadow:0 12px 40px rgba(0,0,0,0.08);
  }
  h1{ font-size:17px; margin:0 0 16px; text-align:center; font-weight:700; }
  input[type="password"]{
    width:100%; padding:10px 12px; border:1.5px solid var(--border); border-radius:6px;
    font-size:14px; margin-bottom:12px; background:#fff; color:var(--text);
  }
  input[type="password"]:focus{ outline:2.5px solid var(--focus); outline-offset:1px; }
  button{
    width:100%; padding:10px; border-radius:6px; border:1.5px solid var(--text);
    background:var(--text); color:var(--paper); font-size:14px; font-weight:600; cursor:pointer;
  }
  button:disabled{ opacity:0.6; cursor:default; }
  .err{ color:var(--neg); font-size:12.5px; margin:0 0 10px; min-height:15px; text-align:center; }
</style>
</head>
<body>
  <form id="loginForm" autocomplete="off">
    <h1>Trailhead</h1>
    <p class="err" id="loginErr"></p>
    <input type="password" id="loginPassword" name="password" placeholder="Password" autocomplete="current-password" autofocus required>
    <button type="submit" id="loginBtn">Unlock</button>
  </form>
  <script>
    document.getElementById("loginForm").addEventListener("submit", function (e) {
      e.preventDefault();
      var btn = document.getElementById("loginBtn");
      var err = document.getElementById("loginErr");
      var pw = document.getElementById("loginPassword").value;
      btn.disabled = true;
      err.textContent = "";
      fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: pw })
      }).then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (body) { return { ok: res.ok, body: body }; });
      }).then(function (r) {
        if (r.ok && r.body && r.body.ok) { location.reload(); return; }
        err.textContent = (r.body && r.body.message) || "Incorrect password.";
        btn.disabled = false;
      }).catch(function () {
        err.textContent = "Something went wrong — try again.";
        btn.disabled = false;
      });
    });
  </script>
</body>
</html>
`;

/** Applied first, before every route: gates the whole app when a password is configured. */
function gate(req, res, next) {
  if (!isEnabled()) return next();
  if (req.path === "/api/auth/login" || req.path === "/api/auth/logout") return next();
  // Vercel Cron calls this with no session — it's protected separately by
  // CRON_SECRET in server/routes/cron.js instead of the password gate.
  if (req.path === "/api/cron/tick") return next();
  if (hasValidSession(req)) return next();

  if (req.path.startsWith("/api/")) {
    return res.status(401).json({ ok: false, message: "Not authenticated." });
  }
  res.status(401).set("Content-Type", "text/html").send(LOGIN_PAGE_HTML);
}

function login(req, res) {
  if (!isEnabled()) return res.json({ ok: true });
  const password = (req.body && req.body.password) || "";
  if (!password || !safeEqual(password, process.env.TRAILHEAD_PASSWORD)) {
    return res.status(401).json({ ok: false, message: "Incorrect password." });
  }
  setSessionCookie(res);
  res.json({ ok: true });
}

function logout(req, res) {
  clearSessionCookie(res);
  res.json({ ok: true });
}

module.exports = { isEnabled, gate, login, logout };
