"use strict";

const { resilientFetch } = require("./resilientFetch");
const settings = require("./settingsService");

/** Posts a raw payload to the configured webhook. Never throws — always resolves to {ok, message?}. */
async function postToWebhook(payload) {
  const url = settings.getWebhookUrl();
  if (!url) {
    return { ok: false, code: "NO_WEBHOOK", message: "No Discord webhook is configured yet. Add one in Settings." };
  }
  try {
    const res = await resilientFetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      timeoutMs: 8000,
      retries: 2,
    });
    if (res.ok || res.status === 204) return { ok: true };
    let message = "Discord responded with an error (" + res.status + ").";
    if (res.status === 401 || res.status === 404) {
      message = "That webhook URL looks invalid or was deleted. Check Server Settings → Integrations → Webhooks.";
    } else if (res.status === 429) {
      message = "Discord is rate-limiting these — wait a few seconds and try again.";
    }
    return { ok: false, code: "DISCORD_ERROR", status: res.status, message };
  } catch (err) {
    return { ok: false, code: "NETWORK", message: "Couldn't reach Discord. Check your connection and try again." };
  }
}

/**
 * Builds the automatic liquidity-threshold alert payload. Uses @everyone in
 * `content` *and* sets `allowed_mentions` explicitly so Discord actually
 * parses and displays the mention rather than silently swallowing it.
 */
function buildLiquidityAlertPayload(row, chain, threshold) {
  const fields = [
    { name: "Liquidity", value: formatCompact(row.liquidityUsd), inline: true },
    { name: "Threshold", value: formatCompact(threshold), inline: true },
  ];
  if (row.priceUsd != null) fields.push({ name: "Price", value: formatPrice(row.priceUsd), inline: true });
  if (row.priceChangeH24 != null) fields.push({ name: "24h change", value: formatPct(row.priceChangeH24), inline: true });
  if (row.volumeH24 != null) fields.push({ name: "24h volume", value: formatCompact(row.volumeH24), inline: true });
  fields.push({ name: "Chain", value: chain.label, inline: true });
  fields.push({ name: "Contract", value: "`" + row.address + "`", inline: false });

  return {
    username: "Trailhead",
    content: "@everyone **Liquidity alert** — " + (row.symbol || "?") + " just crossed your threshold.",
    allowed_mentions: { parse: ["everyone"] },
    embeds: [
      {
        title: (row.symbol + " — " + row.name).trim(),
        url: row.chartUrl || row.explorerUrl,
        description: "Liquidity reached " + formatCompact(row.liquidityUsd) + " on " + chain.label + ".",
        color: chain.discordColor,
        fields,
        footer: { text: "Trailhead liquidity alert — not financial advice, always verify yourself" },
        timestamp: new Date().toISOString(),
      },
    ],
  };
}

function formatCompact(value) {
  const n = Number(value);
  if (!isFinite(n)) return "—";
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  if (abs >= 1e12) return sign + "$" + (abs / 1e12).toFixed(2) + "T";
  if (abs >= 1e9) return sign + "$" + (abs / 1e9).toFixed(2) + "B";
  if (abs >= 1e6) return sign + "$" + (abs / 1e6).toFixed(2) + "M";
  if (abs >= 1e3) return sign + "$" + (abs / 1e3).toFixed(1) + "K";
  return sign + "$" + abs.toFixed(0);
}

function formatPrice(value) {
  const n = Number(value);
  if (!isFinite(n)) return "—";
  if (n === 0) return "$0.00";
  const abs = Math.abs(n);
  if (abs >= 1) return "$" + abs.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return "$" + abs.toFixed(8);
}

function formatPct(value) {
  const n = Number(value);
  if (!isFinite(n)) return "—";
  return (n > 0 ? "+" : "") + n.toFixed(1) + "%";
}

module.exports = { postToWebhook, buildLiquidityAlertPayload };
