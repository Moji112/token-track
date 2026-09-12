"use strict";

function numOr0(v) {
  const n = Number(v);
  return isFinite(n) ? n : 0;
}

function safeUrl(url) {
  if (typeof url !== "string") return "";
  if (/^https:\/\//i.test(url) || /^http:\/\//i.test(url)) return url;
  return "";
}

function extractAddress(t) {
  const a = (t && (t.address_hash || t.address)) || "";
  if (typeof a === "string") return a;
  if (a && typeof a === "object" && typeof a.hash === "string") return a.hash;
  return "";
}

function computeSupplyDisplay(raw, decimals) {
  if (raw === null || raw === undefined || raw === "") return null;
  try {
    const n = Number(raw);
    if (!isFinite(n)) return null;
    const d = decimals === null || decimals === undefined || isNaN(decimals) ? 0 : Number(decimals);
    return d ? n / Math.pow(10, d) : n;
  } catch (e) {
    return null;
  }
}

function safeMap(list, fn) {
  const out = [];
  (list || []).forEach((item) => {
    try {
      const r = fn(item);
      if (r) out.push(r);
    } catch (e) {
      /* skip malformed item rather than fail the whole list */
    }
  });
  return out;
}

module.exports = { numOr0, safeUrl, extractAddress, computeSupplyDisplay, safeMap };
