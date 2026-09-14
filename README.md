# Trailhead — token & NFT tracker with Discord liquidity alerts

A Node/Express rebuild of the original single-file Trailhead tracker. Same
coin/NFT discovery experience (Ethereum, Ink, Robinhood Chain, Base, and
Solana — live from each EVM chain's Blockscout explorer plus DexScreener
everywhere), now with:

- A **configurable liquidity alert threshold** you set from the UI.
- A background monitor that watches live liquidity and pings a **Discord
  webhook with `@everyone`** the moment a token is at or above your threshold.
- A resilient server-side data layer (timeouts, retries, backoff, rate-limit
  handling, stale-while-revalidate caching) so one flaky API call never
  blanks the list or shows a dead-end error.

## Run it

```bash
npm install
npm start
```

Then open http://localhost:3000. Use `npm run dev` instead of `npm start`
while developing — it restarts on file changes.

## Password-protecting it

Off by default. To require a password, copy `.env.example` to `.env` and set:

```
TRAILHEAD_PASSWORD=something-only-you-know
```

Restart the server and every page/request now shows a small login screen —
password only, no username. On success it sets a signed session cookie
(good for 30 days) rather than the browser's native Basic Auth prompt.
`.env` is gitignored, so the password never gets committed; on a host, set
`TRAILHEAD_PASSWORD` as an environment variable there instead of a file.
Leave it unset to run without a login prompt. Changing the password
invalidates every existing session, since the session token is signed with
a key derived from the password itself.

## Deploying

This app needs a host that keeps a Node **process** running continuously —
the background liquidity monitor is a `setInterval` loop, and settings are
persisted to a local file. That rules out plain serverless platforms
(Vercel, Netlify Functions, etc.): they freeze/kill the process between
requests, which would silently stop the automatic Discord alerts and reset
your webhook/threshold. Railway and Render both run a real persistent
process and work with zero code changes:

**Railway**
1. New Project → Deploy from GitHub repo → pick this repo.
2. It auto-detects Node (via `package.json`) and runs `npm install` then
   `npm start`. No config needed.
3. Add a variable `TRAILHEAD_PASSWORD` (Settings → Variables) if you want
   password protection. Don't set `PORT` — Railway injects it.
4. Optional but recommended: add a **Volume** mounted at `/app/data` so
   `data/settings.json` (webhook, threshold, sent-alert history) survives
   redeploys instead of resetting each time.

**Render**
1. New → Web Service → connect this repo.
2. Build command: `npm install`. Start command: `npm start`.
3. Add environment variable `TRAILHEAD_PASSWORD` if wanted. Render sets
   `PORT` automatically.
4. Optional but recommended: add a **Persistent Disk** mounted at
   `/opt/render/project/src/data` for the same reason as above (needs a
   paid instance type — Render's free tier has no persistent disks, so
   `data/settings.json` will reset on every redeploy/restart there).

### Deploying to Vercel anyway

If you still want it on Vercel, pick **Other** as the framework when
importing the repo — this project ships a `vercel.json` + `api/index.js`
that wrap the same Express app as a serverless function. Add
`TRAILHEAD_PASSWORD` as a Vercel Environment Variable if you want the
password gate there too.

**Automatic alerts on Vercel need Cron + environment-variable settings —
the in-app Settings UI alone won't work there.** Two things are different
on serverless, both handled by `server/routes/cron.js` +
`server/lib/settingsService.js`'s environment-variable overrides:

- A `setInterval` loop can't survive between serverless invocations, so
  nothing runs the monitor on its own. `vercel.json` declares a Cron Job
  hitting `/api/cron/tick` on a schedule instead, which runs one check cycle
  and returns. **Vercel's Hobby plan only allows a cron to run once per
  day** — the default schedule (`"0 0 * * *"`, midnight UTC) is set
  conservatively for that. On Pro, edit the schedule in `vercel.json` to
  something like `"*/5 * * * *"` for near-real-time checks.
- Local storage (`data/settings.json`, living in `/tmp` on Vercel) isn't
  shared between separate invocations, so a cron-triggered check wouldn't
  see a webhook/threshold saved through the UI from a browser request.
  Set these as Vercel Environment Variables instead, and they take priority
  over the file store automatically:
  - `TRAILHEAD_LIQUIDITY_THRESHOLD` — e.g. `20000`
  - `TRAILHEAD_WEBHOOK_URL` — your Discord webhook URL
  - `CRON_SECRET` — any random string; Vercel automatically sends it as a
    Bearer token on cron calls, so set this too or the endpoint is callable
    by anyone who finds it (it just runs a check cycle — not dangerous, but
    still worth locking down)

  With these set, the Settings UI shows the threshold/webhook as
  environment-managed and refuses to change them there (edit the Vercel
  env vars instead) — this keeps every invocation, cron included, seeing
  the same values.

One more caveat if you go past once-daily on Pro: the "don't alert twice
for the same crossing" and watchlist-move dedupe state also live in that
same non-shared `/tmp` file, so a several-times-a-minute cron could re-fire
the same alert repeatedly instead of once. Fine at once-a-day; if you want
frequent Cron without repeat spam, that needs real shared storage (Vercel
KV or Upstash Redis) instead of the file store — ask if you want that built
out.

Either way, once it's deployed, open the URL — if you used environment
variables for the webhook/threshold, alerts are already armed; if not, set
them from Settings the same way as locally (this only actually gets checked
by Cron, not by simply visiting the page).

## Configuring alerts

Open **Discord alerts** (top right):

1. **Liquidity alert threshold** — enter a USD amount (e.g. `20000`) and
   press Save. Leave it empty to turn alerts off. This value is read live on
   every check — nothing is hardcoded.
2. **Webhook URL** — paste a Discord webhook URL and press Save (or "Send
   test message" to save + verify in one step). The URL is written to
   `data/settings.json` on the server and is **never sent back to the
   browser** — the page only ever knows whether a webhook is configured, not
   what it is.

Once both are set, a background job checks live liquidity for every chain
roughly every 30 seconds and posts an `@everyone` alert (with
`allowed_mentions` explicitly set so Discord actually renders the mention)
the first time each token crosses your threshold. It won't re-alert the same
token for the same threshold value again — change the threshold and that
token becomes eligible to alert again if it still qualifies.

Manual "Send to Discord" buttons on individual coins/NFTs still work exactly
as before, minus the `@everyone` (that's reserved for automatic threshold
alerts) — they're relayed through the server too, so the webhook URL never
touches client-side code.

## Reliability

`server/lib/resilientFetch.js` wraps every outbound request (Blockscout,
DexScreener, Discord) with a request timeout, bounded retries with
exponential backoff, and explicit handling of `429` (respects `Retry-After`)
and `5xx` responses. `server/lib/dataCache.js` layers stale-while-error
caching on top: if a refresh fails, the API returns the last known-good data
marked `stale: true` with a short warning instead of an error, so the
frontend keeps showing real data and a small inline note rather than wiping
the list. The background monitor (`server/lib/monitor.js`) checks each chain
independently and never lets one chain's failure stop the others or kill the
polling loop.

## Solana

Solana is non-EVM, so it plugs into the two parts of the app that are
chain-agnostic (DexScreener-backed "Freshly listed" / "Trending now" /
search, and the liquidity monitor) but not the Blockscout-only parts:

- **"Most held" and the NFT tab** are intentionally empty for Solana — both
  rely on an EVM Blockscout instance, which doesn't exist for Solana. The
  chain note in the UI explains this and points at the other two coin tabs;
  the NFT tab links out to Magic Eden/Tensor instead.
- **Addresses are never lowercased for Solana.** EVM addresses are
  case-insensitive so the app normalizes them for URLs/dedup; Solana's
  base58 addresses are case-sensitive, so `server/lib/chains.js`'
  `normalizeAddress()` leaves them untouched (`isEvm: false`) — explorer
  links and copy-address stay correct.
- Liquidity alerts, search, and the live/stale-data handling all work the
  same as the other chains, since those paths go through DexScreener rather
  than Blockscout.

Adding another chain follows the same pattern: an entry in `CHAINS` (plus
`NFT_INFO`) in `server/lib/chains.js`, and `isEvm`/`supportsBlockscout: false`
if it isn't an EVM chain with a Blockscout instance.

## Project layout

```
server/
  index.js            Express app + startup
  lib/
    resilientFetch.js   timeout/retry/backoff fetch wrapper
    dataCache.js         stale-while-error cache
    chains.js            chain + NFT metadata
    coinsData.js          Blockscout + DexScreener composition (coins)
    nftData.js             Blockscout NFT contract listing
    settingsService.js      threshold + webhook persistence/validation
    store.js                  tiny JSON key/value store (data/settings.json)
    discordClient.js           webhook posting + alert payload builder
    alertTracker.js             dedupes liquidity alerts per token/threshold
    monitor.js                   background liquidity-threshold watcher
  routes/                API endpoints consumed by the frontend
webapp/
  index.html, styles.css, app.js   the UI (deliberately not named "public" —
                                    Vercel auto-serves a top-level "public/"
                                    folder as static files, bypassing this
                                    app and its auth gate entirely)
```
