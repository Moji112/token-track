(function () {
  "use strict";

  var POLL_MS = 20000; // background auto-refresh — keeps data "live" without user action

  var CHAINS = {}; // populated from /api/chains
  var NFT_INFO = {};

  var SORT_FNS = {
    liquidity: function (a, b) { return numOr0(b.liquidityUsd) - numOr0(a.liquidityUsd); },
    volume: function (a, b) { return numOr0(b.volumeH24) - numOr0(a.volumeH24); },
    newest: function (a, b) { return numOr0(b.pairCreatedAt) - numOr0(a.pairCreatedAt); },
    change: function (a, b) { return numOr0(b.priceChangeH24) - numOr0(a.priceChangeH24); },
    holders: function (a, b) { return numOr0(b.holders) - numOr0(a.holders); },
    marketcap: function (a, b) { return numOr0(b.circulatingMarketCap) - numOr0(a.circulatingMarketCap); }
  };

  var SORT_OPTIONS = {
    mostheld: [["holders", "Sort: Holders"], ["marketcap", "Sort: Market cap"], ["liquidity", "Sort: Liquidity (if trading)"], ["change", "Sort: 24h change (if trading)"]],
    new: [["liquidity", "Sort: Liquidity"], ["volume", "Sort: 24h volume"], ["newest", "Sort: Newest"], ["change", "Sort: 24h change"]],
    boosted: [["liquidity", "Sort: Liquidity"], ["volume", "Sort: 24h volume"], ["newest", "Sort: Newest"], ["change", "Sort: 24h change"]],
    search: [["liquidity", "Sort: Liquidity"], ["volume", "Sort: 24h volume"], ["newest", "Sort: Newest"], ["change", "Sort: 24h change"]]
  };

  var state = {
    chain: "ethereum",
    view: "coins",
    feed: "mostheld",
    sort: "holders",
    searchActive: false,
    currentRows: [],
    rowsByAddress: {},
    nftByAddress: {},
    lastGoodAt: null,
    lastAttemptOk: true,
    settings: { liquidityThreshold: null, webhookConfigured: false, monitor: null }
  };

  // ---------- utils ----------
  function numOr0(v) { var n = Number(v); return isFinite(n) ? n : 0; }

  function escapeHtml(str) {
    if (str === null || str === undefined) return "";
    return String(str).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c];
    });
  }

  function safeUrl(url) {
    if (typeof url !== "string") return "";
    if (/^https:\/\//i.test(url) || /^http:\/\//i.test(url)) return url;
    return "";
  }

  function shortAddr(addr) {
    if (!addr || addr.length < 12) return addr || "—";
    return addr.slice(0, 6) + "…" + addr.slice(-4);
  }

  function formatPrice(value) {
    var n = Number(value);
    if (!isFinite(n)) return "—";
    if (n === 0) return "$0.00";
    var sign = n < 0 ? "-" : "";
    var abs = Math.abs(n);
    if (abs >= 1) return sign + "$" + abs.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    var fixed = abs.toFixed(18);
    var afterDot = fixed.split(".")[1] || "";
    var leadingZeros = 0;
    for (var i = 0; i < afterDot.length; i++) { if (afterDot[i] === "0") leadingZeros++; else break; }
    var totalDecimals = Math.min(leadingZeros + 4, 18);
    return sign + "$" + abs.toFixed(totalDecimals);
  }

  function formatCompact(value) {
    var n = Number(value);
    if (!isFinite(n)) return "—";
    var sign = n < 0 ? "-" : "";
    var abs = Math.abs(n);
    if (abs >= 1e15) return sign + "$" + (abs / 1e15).toFixed(2) + "Q";
    if (abs >= 1e12) return sign + "$" + (abs / 1e12).toFixed(2) + "T";
    if (abs >= 1e9) return sign + "$" + (abs / 1e9).toFixed(2) + "B";
    if (abs >= 1e6) return sign + "$" + (abs / 1e6).toFixed(2) + "M";
    if (abs >= 1e3) return sign + "$" + (abs / 1e3).toFixed(1) + "K";
    return sign + "$" + abs.toFixed(0);
  }

  function formatCompactNumber(value) {
    var n = Number(value);
    if (!isFinite(n)) return "—";
    var sign = n < 0 ? "-" : "";
    var abs = Math.abs(n);
    if (abs >= 1e15) return sign + (abs / 1e15).toFixed(2) + "Q";
    if (abs >= 1e12) return sign + (abs / 1e12).toFixed(2) + "T";
    if (abs >= 1e9) return sign + (abs / 1e9).toFixed(2) + "B";
    if (abs >= 1e6) return sign + (abs / 1e6).toFixed(2) + "M";
    if (abs >= 1e3) return sign + (abs / 1e3).toFixed(1) + "K";
    return sign + abs.toFixed(0);
  }

  function formatPct(value) {
    var n = Number(value);
    if (!isFinite(n)) return "—";
    var sign = n > 0 ? "+" : "";
    return sign + n.toFixed(1) + "%";
  }

  function formatAge(ts) {
    var n = Number(ts);
    if (!n) return "—";
    var diff = Date.now() - n;
    if (diff < 0) diff = 0;
    var mins = diff / 60000;
    if (mins < 60) return Math.max(1, Math.round(mins)) + "m";
    var hours = mins / 60;
    if (hours < 24) return Math.round(hours) + "h";
    var days = hours / 24;
    if (days < 30) return Math.round(days) + "d";
    var months = days / 30;
    if (months < 12) return Math.round(months) + "mo";
    return Math.round(months / 12) + "y";
  }

  function formatRelative(ts) {
    if (!ts) return "never";
    var diff = Math.max(0, Date.now() - ts);
    var s = Math.round(diff / 1000);
    if (s < 5) return "just now";
    if (s < 60) return s + "s ago";
    var m = Math.round(s / 60);
    if (m < 60) return m + "m ago";
    var h = Math.round(m / 60);
    return h + "h ago";
  }

  function liquidityTier(usd) {
    var n = numOr0(usd);
    if (n < 5000) return { label: "Very low liquidity", level: "danger" };
    if (n < 50000) return { label: "Low liquidity", level: "warn" };
    if (n < 250000) return { label: "Moderate liquidity", level: "ok" };
    return { label: "Higher liquidity", level: "good" };
  }

  function holdersTier(n) {
    if (n === null || n === undefined) return null;
    if (n < 10) return { label: "Very few holders", level: "danger" };
    if (n < 100) return { label: "Few holders", level: "warn" };
    if (n < 1000) return { label: "Some holders", level: "ok" };
    return { label: "Widely held", level: "good" };
  }

  function ageTier(ts) {
    var n = numOr0(ts);
    if (!n) return null;
    var days = (Date.now() - n) / 86400000;
    if (days < 1) return { label: "Brand new (<1d)", level: "danger" };
    if (days < 7) return { label: "New (<1wk)", level: "warn" };
    return null;
  }

  function resolveMediaUrl(url) {
    if (!url || typeof url !== "string") return "";
    if (url.indexOf("ipfs://") === 0) return "https://ipfs.io/ipfs/" + url.slice(7);
    if (/^https?:\/\//i.test(url)) return url;
    return "";
  }

  function statHTML(label, value, cls) {
    return '<div class="stat"><span class="stat-label">' + label + '</span><span class="stat-value mono' +
      (cls ? " " + cls : "") + '">' + value + '</span></div>';
  }

  function showToast(message, type) {
    var el = document.getElementById("toast");
    el.textContent = message;
    el.className = "show" + (type ? " " + type : "");
    clearTimeout(showToast._t);
    showToast._t = setTimeout(function () { el.className = ""; }, 4200);
  }

  function safeMap(list, fn) {
    var out = [];
    (list || []).forEach(function (item) {
      try { var r = fn(item); if (r) out.push(r); } catch (e) { /* skip malformed item */ }
    });
    return out;
  }

  function jsonFetch(url, opts) {
    return fetch(url, opts).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (body) {
        return body;
      });
    });
  }

  // ---------- live pill ----------
  function markFetchOutcome(ok) {
    state.lastAttemptOk = ok;
    if (ok) state.lastGoodAt = Date.now();
    renderLivePill();
  }

  function renderLivePill() {
    var pill = document.getElementById("livePill");
    var text = document.getElementById("livePillText");
    if (!state.lastGoodAt) {
      pill.className = "live-pill down";
      text.textContent = "Waiting for data…";
    } else if (state.lastAttemptOk) {
      pill.className = "live-pill";
      text.textContent = "Live · updated " + formatRelative(state.lastGoodAt);
    } else {
      pill.className = "live-pill stale";
      text.textContent = "Reconnecting… last data " + formatRelative(state.lastGoodAt);
    }
  }
  setInterval(renderLivePill, 5000);

  // ---------- chains / settings bootstrap ----------
  function loadChains() {
    return jsonFetch("/api/chains").then(function (body) {
      (body.data || []).forEach(function (c) {
        CHAINS[c.key] = c;
        NFT_INFO[c.key] = c.nft;
      });
    });
  }

  function loadSettings() {
    return jsonFetch("/api/settings").then(function (body) {
      if (body && body.ok) state.settings = body.data;
      updateWebhookDot();
      return state.settings;
    });
  }

  function updateWebhookDot() {
    var btn = document.getElementById("openSettings");
    var armed = state.settings.webhookConfigured && state.settings.liquidityThreshold != null;
    var partial = state.settings.webhookConfigured || state.settings.liquidityThreshold != null;
    btn.classList.toggle("on", !!armed);
    btn.classList.toggle("partial", !armed && !!partial);
  }

  // ---------- rendering: chain tabs / notes ----------
  function renderChainTabs() {
    var el = document.getElementById("chainTabs");
    el.innerHTML = Object.keys(CHAINS).map(function (key) {
      var c = CHAINS[key];
      var active = key === state.chain ? " active" : "";
      return '<button class="chain-tab' + active + '" data-chain="' + key + '" role="tab" aria-selected="' +
        (key === state.chain) + '" type="button"><span class="swatch"></span>' + escapeHtml(c.label) + "</button>";
    }).join("");
  }

  function updateChainUI() {
    document.querySelectorAll(".chain-tab").forEach(function (btn) {
      btn.classList.toggle("active", btn.getAttribute("data-chain") === state.chain);
    });
    var c = CHAINS[state.chain];
    document.getElementById("chainNote").textContent = c.note;
    var warnEl = document.getElementById("chainWarn");
    if (c.warn) { warnEl.style.display = "block"; warnEl.textContent = c.warn; }
    else { warnEl.style.display = "none"; warnEl.textContent = ""; }
    renderNftLinksPanel();
  }

  // ---------- rendering: coin rows ----------
  function coinRowHTML(row) {
    var iconUrl = safeUrl(row.iconUrl);
    var symbol = row.symbol || "?";
    var iconHtml = iconUrl
      ? '<img src="' + escapeHtml(iconUrl) + '" alt="" loading="lazy" onerror="this.parentElement.innerHTML=\'<span class=&quot;icon-fallback&quot;>' + escapeHtml(symbol.slice(0, 1)) + '</span>\'">'
      : '<span class="icon-fallback">' + escapeHtml(symbol.slice(0, 1)) + '</span>';

    var badges = "";
    if (row.hasDex) {
      var liqTier = liquidityTier(row.liquidityUsd);
      badges += '<span class="chip chip-' + liqTier.level + '">' + liqTier.label + '</span>';
      var ageT = ageTier(row.pairCreatedAt);
      if (ageT) badges += '<span class="chip chip-' + ageT.level + '">' + ageT.label + '</span>';
      var threshold = state.settings.liquidityThreshold;
      if (threshold != null && numOr0(row.liquidityUsd) >= threshold) {
        badges += '<span class="chip chip-alert">≥ your $' + formatCompactNumber(threshold) + ' alert</span>';
      }
    } else {
      var hTier = holdersTier(row.holders);
      if (hTier) badges += '<span class="chip chip-' + hTier.level + '">' + hTier.label + '</span>';
      badges += '<span class="chip chip-ok">No live trading pair found</span>';
    }
    if (row.boosted) badges += '<span class="chip chip-boost">Paid promotion</span>';

    var statsHtml;
    if (row.hasDex) {
      var chgClass = numOr0(row.priceChangeH24) > 0 ? "pos" : (numOr0(row.priceChangeH24) < 0 ? "neg" : "");
      statsHtml =
        statHTML("price", formatPrice(row.priceUsd)) +
        statHTML("24h", formatPct(row.priceChangeH24), chgClass) +
        statHTML("liquidity", formatCompact(row.liquidityUsd)) +
        statHTML("vol 24h", formatCompact(row.volumeH24)) +
        statHTML("age", formatAge(row.pairCreatedAt));
    } else {
      var priceVal = row.exchangeRateUsd;
      statsHtml =
        statHTML("price", priceVal != null ? formatPrice(priceVal) : "—") +
        statHTML("holders", row.holders != null ? row.holders.toLocaleString("en-US") : "—") +
        statHTML("supply", row.totalSupplyDisplay != null ? formatCompactNumber(row.totalSupplyDisplay) : "—") +
        statHTML("mkt cap", row.circulatingMarketCap != null ? formatCompact(row.circulatingMarketCap) : "—");
    }

    var actionsHtml = "";
    if (row.chartUrl) actionsHtml += '<a class="btn-ghost" href="' + escapeHtml(row.chartUrl) + '" target="_blank" rel="noopener noreferrer">View chart</a>';
    actionsHtml += '<a class="btn-ghost" href="' + escapeHtml(row.explorerUrl) + '" target="_blank" rel="noopener noreferrer">View on explorer</a>';
    actionsHtml += '<button class="btn-ghost" data-action="copy" data-address="' + escapeHtml(row.address) + '" title="' + escapeHtml(row.address) + '">Copy ' + escapeHtml(shortAddr(row.address)) + '</button>';
    actionsHtml += '<button class="btn-primary-sm" data-action="discord" data-address="' + escapeHtml(row.address) + '">Send to Discord</button>';

    return (
      '<div class="row" data-address="' + escapeHtml(row.address) + '">' +
        '<div class="row-icon">' + iconHtml + '</div>' +
        '<div class="row-main">' +
          '<div class="row-title"><span class="sym">' + escapeHtml(symbol) + '</span><span class="name">' + escapeHtml(row.name) + '</span></div>' +
          '<div class="row-badges">' + badges + '</div>' +
        '</div>' +
        '<div class="row-stats">' + statsHtml + '</div>' +
        '<div class="row-actions">' + actionsHtml + '</div>' +
      '</div>'
    );
  }

  function renderRows(rows) {
    state.currentRows = rows;
    state.rowsByAddress = {};
    rows.forEach(function (r) { if (r && r.address) state.rowsByAddress[r.address] = r; });
    var el = document.getElementById("coinList");
    if (rows.length === 0) {
      el.innerHTML = '<div class="state-msg">No results here yet on this chain. Try another tab, or search for a specific coin by name or contract address above.</div>';
      return;
    }
    el.innerHTML = rows.map(coinRowHTML).join("");
  }

  function renderSkeleton() {
    var el = document.getElementById("coinList");
    var rows = "";
    for (var i = 0; i < 5; i++) rows += '<div class="skeleton-row"><div class="skeleton-bar"></div></div>';
    el.innerHTML = rows;
  }

  function renderBanner(elId, warning, emptyMessage, retryFn) {
    var el = document.getElementById(elId);
    if (warning) {
      el.innerHTML = '<div class="note-inline stale">' + escapeHtml(warning) + '</div>';
    } else if (emptyMessage) {
      el.innerHTML = '<div class="state-msg">' + escapeHtml(emptyMessage) + '<br><button class="btn secondary retry" id="' + elId + 'Retry" type="button">Try again</button></div>';
      var btn = document.getElementById(elId + "Retry");
      if (btn) btn.addEventListener("click", retryFn);
    } else {
      el.innerHTML = "";
    }
  }

  // ---------- sort options ----------
  function updateSortOptions(feedKey) {
    var opts = SORT_OPTIONS[feedKey] || SORT_OPTIONS.new;
    var sel = document.getElementById("sortSelect");
    sel.innerHTML = opts.map(function (o) { return '<option value="' + o[0] + '">' + o[1] + '</option>'; }).join("");
    state.sort = opts[0][0];
    sel.value = state.sort;
  }

  // ---------- coin data flow ----------
  function refreshCoinList(silent) {
    if (!silent) renderSkeleton();
    return jsonFetch("/api/coins/" + state.chain + "/" + state.feed).then(function (body) {
      if (body.ok) {
        markFetchOutcome(true);
        renderBanner("coinListBanner", body.warning, null, null);
        renderRows((body.data || []).slice().sort(SORT_FNS[state.sort]));
      } else if (body.data && body.data.length) {
        markFetchOutcome(false);
        renderBanner("coinListBanner", body.message, null, null);
      } else {
        markFetchOutcome(false);
        if (!silent || state.currentRows.length === 0) {
          renderBanner("coinListBanner", null, body.message || "Live data hasn't loaded yet.", function () { refreshCoinList(false); });
          if (!state.currentRows.length) document.getElementById("coinList").innerHTML = "";
        }
      }
    }).catch(function () {
      markFetchOutcome(false);
    });
  }

  function doSearch() {
    var q = document.getElementById("searchInput").value.trim();
    if (!q) {
      state.searchActive = false;
      updateSortOptions(state.feed);
      return refreshCoinList(false);
    }
    state.searchActive = true;
    updateSortOptions("search");
    renderSkeleton();
    return jsonFetch("/api/coins/" + state.chain + "/search?q=" + encodeURIComponent(q)).then(function (body) {
      if (body.ok) {
        markFetchOutcome(true);
        renderBanner("coinListBanner", body.warning, null, null);
        renderRows((body.data || []).slice().sort(SORT_FNS[state.sort]));
      } else {
        markFetchOutcome(false);
        renderBanner("coinListBanner", null, body.message || "Search is temporarily unavailable.", doSearch);
      }
    });
  }

  function switchChain(key, force) {
    state.chain = key;
    state.searchActive = false;
    document.getElementById("searchInput").value = "";
    updateChainUI();
    return Promise.all([refreshCoinList(false), ensureNftLoaded(key)]);
  }

  // ---------- NFT rendering ----------
  function nftCollectionCardHTML(item, chainKey) {
    var addr = (item.address || "").toLowerCase();
    var symbol = item.symbol || "?";
    var name = item.name || "Unnamed collection";
    var type = item.type || "ERC-721";
    var holders = item.holders_count != null ? Number(item.holders_count) : null;
    var supplyDisp = item.total_supply != null ? Number(item.total_supply) : null;
    var iconUrl = safeUrl(item.icon_url);
    var explorerUrl = item.explorerUrl;
    var iconHtml = iconUrl
      ? '<img src="' + escapeHtml(iconUrl) + '" alt="" loading="lazy" onerror="this.parentElement.innerHTML=\'<span class=&quot;icon-fallback&quot;>' + escapeHtml(symbol.slice(0, 1)) + '</span>\'">'
      : '<span class="icon-fallback">' + escapeHtml(symbol.slice(0, 1)) + '</span>';

    return (
      '<div class="nft-collection-card" data-address="' + escapeHtml(addr) + '">' +
        '<div class="row no-border">' +
          '<div class="row-icon">' + iconHtml + '</div>' +
          '<div class="row-main">' +
            '<div class="row-title"><span class="sym">' + escapeHtml(name) + '</span><span class="name">' + escapeHtml(symbol) + '</span></div>' +
            '<div class="row-badges"><span class="chip chip-ok">' + escapeHtml(type) + '</span></div>' +
          '</div>' +
          '<div class="row-stats">' +
            statHTML("holders", holders != null ? holders.toLocaleString("en-US") : "—") +
            statHTML("items", supplyDisp != null ? formatCompactNumber(supplyDisp) : "—") +
          '</div>' +
          '<div class="row-actions">' +
            '<a class="btn-ghost" href="' + escapeHtml(explorerUrl) + '" target="_blank" rel="noopener noreferrer">View on explorer</a>' +
            '<button class="btn-ghost" data-nft-action="preview" data-address="' + escapeHtml(addr) + '">Preview items</button>' +
            '<button class="btn-primary-sm" data-nft-action="discord" data-address="' + escapeHtml(addr) + '">Send to Discord</button>' +
          '</div>' +
        '</div>' +
        '<div class="nft-preview-slot" id="nft-preview-' + escapeHtml(addr) + '"></div>' +
      '</div>'
    );
  }

  function nftThumbHTML(item) {
    var img = resolveMediaUrl(item.image_url || (item.metadata && item.metadata.image));
    var isImage = !item.media_type || /^image\//i.test(item.media_type);
    var idLabel = "#" + (item.id != null ? item.id : "?");
    if (img && isImage) {
      return '<img class="nft-thumb" src="' + escapeHtml(img) + '" alt="' + escapeHtml(idLabel) + '" loading="lazy" title="' + escapeHtml(idLabel) + '" onerror="this.outerHTML=\'<div class=&quot;nft-thumb-placeholder&quot;>' + escapeHtml(idLabel) + '</div>\'">';
    }
    return '<div class="nft-thumb-placeholder">' + escapeHtml(idLabel) + '</div>';
  }

  function extractNftAddress(t) {
    var a = (t && (t.address_hash || t.address)) || "";
    if (typeof a === "string") return a;
    if (a && typeof a === "object" && typeof a.hash === "string") return a.hash;
    return "";
  }

  function renderNftList(items, chainKey) {
    var el = document.getElementById("nftList");
    if (!items.length) {
      el.innerHTML = '<div class="state-msg">No ERC-721/1155/404 contracts turned up from this explorer yet. Try Refresh, or check the links below.</div>';
      return;
    }
    el.innerHTML = items.map(function (it) { return nftCollectionCardHTML(it, chainKey); }).join("");
  }

  function renderNftSkeleton() {
    var el = document.getElementById("nftList");
    var rows = "";
    for (var i = 0; i < 4; i++) rows += '<div class="nft-collection-card"><div class="skeleton-bar" style="height:32px;width:100%;"></div></div>';
    el.innerHTML = rows;
  }

  function renderNftLinksPanel() {
    var info = NFT_INFO[state.chain] || { body: "", links: [] };
    var el = document.getElementById("nftLinksPanel");
    var linksHtml = (info.links || []).map(function (l) {
      return '<a class="btn-ghost" href="' + escapeHtml(safeUrl(l.url)) + '" target="_blank" rel="noopener noreferrer">' + escapeHtml(l.label) + ' ↗</a>';
    }).join("");
    el.innerHTML =
      '<h3>Where else to look on ' + escapeHtml(CHAINS[state.chain].label) + '</h3>' +
      '<p>' + escapeHtml(info.body) + '</p>' +
      '<div class="links-row">' + linksHtml +
        '<button class="btn-ghost" id="shareCustomNft" type="button">Share something else to Discord</button>' +
      '</div>';
    var shareBtn = document.getElementById("shareCustomNft");
    if (shareBtn) shareBtn.addEventListener("click", promptCustomNftShare);
  }

  function ensureNftLoaded(chainKey) {
    renderNftSkeleton();
    return jsonFetch("/api/nft/" + chainKey).then(function (body) {
      var items = (body.data || []).map(function (it) {
        var addr = extractNftAddress(it).toLowerCase();
        return {
          address: addr,
          symbol: it.symbol, name: it.name, type: it.type,
          holders_count: it.holders_count,
          total_supply: it.total_supply,
          icon_url: it.icon_url,
          explorerUrl: chainKey === "ethereum"
            ? "https://etherscan.io/address/" + addr
            : explorerBase(chainKey) + "/address/" + addr
        };
      });
      state.nftByAddress = {};
      items.forEach(function (it) { if (it.address) state.nftByAddress[it.address] = it; });
      if (body.ok) {
        markFetchOutcome(true);
        renderBanner("nftListBanner", body.warning, null, null);
        renderNftList(items, chainKey);
      } else if (items.length) {
        markFetchOutcome(false);
        renderBanner("nftListBanner", body.message, null, null);
        renderNftList(items, chainKey);
      } else {
        markFetchOutcome(false);
        renderBanner("nftListBanner", null, body.message || "Couldn't load NFT contracts yet.", function () { ensureNftLoaded(chainKey); });
        document.getElementById("nftList").innerHTML = "";
      }
    });
  }

  var EXPLORER_BASE = {
    ethereum: "https://eth.blockscout.com",
    ink: "https://explorer.inkonchain.com",
    robinhood: "https://robinhoodchain.blockscout.com"
  };
  function explorerBase(chainKey) { return EXPLORER_BASE[chainKey] || ""; }

  function toggleNftPreview(address) {
    var slot = document.getElementById("nft-preview-" + CSS.escape(address));
    if (!slot) return;
    if (slot.dataset.loaded === "1") { slot.innerHTML = ""; slot.dataset.loaded = ""; return; }
    slot.innerHTML = '<div class="state-msg" style="padding:10px;">Loading preview…</div>';
    jsonFetch("/api/nft/" + state.chain + "/" + address + "/instances").then(function (body) {
      var items = (body.data || []).slice(0, 6);
      if (!items.length) { slot.innerHTML = '<div class="state-msg" style="padding:10px;">No items indexed yet.</div>'; return; }
      slot.innerHTML = '<div class="nft-preview-grid">' + items.map(nftThumbHTML).join("") + '</div>';
      slot.dataset.loaded = "1";
    }).catch(function () {
      slot.innerHTML = '<div class="state-msg" style="padding:10px;">Couldn\'t load a preview right now.</div>';
    });
  }

  // ---------- view switching ----------
  function switchView(view) {
    state.view = view;
    document.querySelectorAll(".view-tab").forEach(function (b) { b.classList.toggle("active", b.getAttribute("data-view") === view); });
    document.getElementById("coinsView").style.display = view === "coins" ? "" : "none";
    document.getElementById("nftsView").style.display = view === "nfts" ? "" : "none";
  }

  // ---------- discord (manual, relayed through the server) ----------
  function relayToDiscord(payload) {
    if (!state.settings.webhookConfigured) {
      showToast("Add a Discord webhook URL in Discord alerts first.", "warn");
      openSettingsModal();
      return Promise.resolve({ ok: false });
    }
    return jsonFetch("/api/discord/relay", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
  }

  function sendCoinToDiscord(address) {
    var row = state.rowsByAddress[address];
    if (!row) return;
    var btn = document.querySelector('[data-action="discord"][data-address="' + CSS.escape(address) + '"]');
    var fields = [];
    if (row.hasDex) {
      fields.push({ name: "Price", value: formatPrice(row.priceUsd), inline: true });
      fields.push({ name: "24h change", value: formatPct(row.priceChangeH24), inline: true });
      fields.push({ name: "Liquidity", value: formatCompact(row.liquidityUsd), inline: true });
      fields.push({ name: "24h volume", value: formatCompact(row.volumeH24), inline: true });
      fields.push({ name: "Pair age", value: formatAge(row.pairCreatedAt), inline: true });
    } else {
      if (row.exchangeRateUsd != null) fields.push({ name: "Price", value: formatPrice(row.exchangeRateUsd), inline: true });
      if (row.holders != null) fields.push({ name: "Holders", value: row.holders.toLocaleString("en-US"), inline: true });
      if (row.circulatingMarketCap != null) fields.push({ name: "Market cap", value: formatCompact(row.circulatingMarketCap), inline: true });
      fields.push({ name: "Live trading pair", value: "Not found", inline: true });
    }
    fields.push({ name: "Contract", value: "`" + row.address + "`", inline: false });
    var payload = {
      embeds: [{
        title: (row.symbol + " — " + row.name).trim(),
        url: row.chartUrl || row.explorerUrl,
        description: "Spotted on " + CHAINS[state.chain].label + " via Trailhead",
        color: (CHAINS[state.chain] && CHAINS[state.chain].discordColor) || 0x5b6ee8,
        fields: fields,
        footer: { text: "Not financial advice — always verify yourself" },
        timestamp: new Date().toISOString()
      }]
    };
    if (btn) { btn.disabled = true; btn.textContent = "Sending…"; }
    relayToDiscord(payload).then(function (result) {
      if (btn) { btn.disabled = false; btn.textContent = "Send to Discord"; }
      if (result.ok) showToast("Sent to Discord.", "ok");
      else if (result.message) showToast(result.message, "err");
    });
  }

  function sendNftToDiscord(address) {
    var item = state.nftByAddress[address];
    if (!item) return;
    var btn = document.querySelector('[data-nft-action="discord"][data-address="' + CSS.escape(address) + '"]');
    var payload = {
      embeds: [{
        title: (item.name || "Unnamed collection") + " (" + (item.symbol || "?") + ")",
        url: item.explorerUrl,
        description: (item.type || "NFT") + " collection on " + CHAINS[state.chain].label + ", shared via Trailhead. Explorer data only — not vetted.",
        color: (CHAINS[state.chain] && CHAINS[state.chain].discordColor) || 0x5b6ee8,
        fields: [
          { name: "Holders", value: item.holders_count != null ? Number(item.holders_count).toLocaleString("en-US") : "—", inline: true },
          { name: "Contract", value: "`" + address + "`", inline: false }
        ],
        timestamp: new Date().toISOString()
      }]
    };
    if (btn) { btn.disabled = true; btn.textContent = "Sending…"; }
    relayToDiscord(payload).then(function (result) {
      if (btn) { btn.disabled = false; btn.textContent = "Send to Discord"; }
      if (result.ok) showToast("Sent to Discord.", "ok");
      else if (result.message) showToast(result.message, "err");
    });
  }

  function promptCustomNftShare() {
    var name = window.prompt("NFT collection or item name to share to Discord:");
    if (!name) return;
    var link = window.prompt("Link to it (optional):", "");
    var payload = {
      embeds: [{
        title: name,
        url: link ? (safeUrl(link) || undefined) : undefined,
        description: "NFT find on " + CHAINS[state.chain].label + ", shared via Trailhead. Not verified — do your own checks before buying.",
        color: (CHAINS[state.chain] && CHAINS[state.chain].discordColor) || 0x5b6ee8,
        timestamp: new Date().toISOString()
      }]
    };
    relayToDiscord(payload).then(function (result) {
      if (result.ok) showToast("Sent to Discord.", "ok");
      else if (result.message) showToast(result.message, "err");
    });
  }

  function copyAddress(address) {
    var row = state.rowsByAddress[address];
    var full = (row && row.address) || address;
    if (!full) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(full).then(function () {
        showToast("Contract address copied. Paste it into your wallet or the explorer to double-check before you trade.", "ok");
      }).catch(function () { fallbackCopy(full); });
    } else {
      fallbackCopy(full);
    }
  }

  function fallbackCopy(text) {
    try {
      var ta = document.createElement("textarea");
      ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select(); document.execCommand("copy"); document.body.removeChild(ta);
      showToast("Contract address copied. Double-check it before you trade.", "ok");
    } catch (e) {
      showToast("Couldn't auto-copy — full address: " + text, "warn");
    }
  }

  // ---------- settings modal ----------
  function renderMonitorStatus() {
    var el = document.getElementById("monitorStatus");
    var s = state.settings;
    var mon = s.monitor || {};
    var lines = [];
    var armed = s.webhookConfigured && s.liquidityThreshold != null;
    lines.push(['Alerts', armed ? "Armed — watching live liquidity" : (s.webhookConfigured ? "Off — set a threshold above" : "Off — add a webhook below")]);
    if (mon.lastTickAt) lines.push(['Last check', formatRelative(mon.lastTickAt)]);
    if (mon.alertsSent) lines.push(['Alerts sent', String(mon.alertsSent) + (mon.lastAlertAt ? " (last " + formatRelative(mon.lastAlertAt) + ")" : "")]);
    el.innerHTML = lines.map(function (l) {
      return '<div class="row-line"><span>' + escapeHtml(l[0]) + '</span><span class="mono">' + escapeHtml(l[1]) + '</span></div>';
    }).join("");
  }

  function openSettingsModal() {
    loadSettings().then(function () {
      document.getElementById("thresholdInput").value = state.settings.liquidityThreshold != null ? state.settings.liquidityThreshold : "";
      document.getElementById("webhookUrlInput").value = "";
      document.getElementById("webhookUrlInput").placeholder = state.settings.webhookConfigured
        ? "•••• a webhook is already saved — paste a new one to replace it"
        : "https://discord.com/api/webhooks/…";
      document.getElementById("webhookStatus").textContent = "";
      renderMonitorStatus();
      document.getElementById("settingsOverlay").classList.add("open");
      document.getElementById("thresholdInput").focus();
    });
  }
  function closeSettingsModal() {
    document.getElementById("settingsOverlay").classList.remove("open");
  }

  function saveThreshold() {
    var raw = document.getElementById("thresholdInput").value.trim();
    var statusEl = document.getElementById("webhookStatus");
    jsonFetch("/api/settings/threshold", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: raw === "" ? null : Number(raw) })
    }).then(function (body) {
      if (body.ok) {
        state.settings.liquidityThreshold = body.data.liquidityThreshold;
        statusEl.className = "modal-status ok";
        statusEl.textContent = body.data.liquidityThreshold != null
          ? "Saved — alerts fire at $" + body.data.liquidityThreshold.toLocaleString("en-US") + " or more liquidity."
          : "Saved — liquidity alerts are off.";
        updateWebhookDot();
        renderMonitorStatus();
      } else {
        statusEl.className = "modal-status err";
        statusEl.textContent = body.message || "Couldn't save that threshold.";
      }
    });
  }

  function saveWebhook() {
    var val = document.getElementById("webhookUrlInput").value.trim();
    var statusEl = document.getElementById("webhookStatus");
    if (!val) { statusEl.className = "modal-status err"; statusEl.textContent = "Paste a webhook URL first, or use Remove to clear it."; return; }
    jsonFetch("/api/settings/webhook", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: val })
    }).then(function (body) {
      if (body.ok) {
        state.settings.webhookConfigured = body.data.webhookConfigured;
        statusEl.className = "modal-status ok";
        statusEl.textContent = "Saved.";
        document.getElementById("webhookUrlInput").value = "";
        document.getElementById("webhookUrlInput").placeholder = "•••• a webhook is already saved — paste a new one to replace it";
        updateWebhookDot();
        renderMonitorStatus();
      } else {
        statusEl.className = "modal-status err";
        statusEl.textContent = body.message || "Couldn't save that webhook URL.";
      }
    });
  }

  function testWebhook() {
    var statusEl = document.getElementById("webhookStatus");
    var typed = document.getElementById("webhookUrlInput").value.trim();
    statusEl.className = "modal-status";
    statusEl.textContent = "Sending test message…";
    var ensureSaved = typed ? jsonFetch("/api/settings/webhook", {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: typed })
    }) : Promise.resolve({ ok: true });
    ensureSaved.then(function (saveResult) {
      if (!saveResult.ok) { statusEl.className = "modal-status err"; statusEl.textContent = saveResult.message; return; }
      if (typed) {
        state.settings.webhookConfigured = true;
        document.getElementById("webhookUrlInput").value = "";
        document.getElementById("webhookUrlInput").placeholder = "•••• a webhook is already saved — paste a new one to replace it";
        updateWebhookDot();
      }
      return jsonFetch("/api/settings/webhook/test", { method: "POST" }).then(function (result) {
        if (result.ok) { statusEl.className = "modal-status ok"; statusEl.textContent = "It worked — check your Discord channel."; }
        else { statusEl.className = "modal-status err"; statusEl.textContent = result.message || "Something went wrong."; }
      });
    });
  }

  function clearWebhook() {
    jsonFetch("/api/settings/webhook", { method: "DELETE" }).then(function () {
      document.getElementById("webhookUrlInput").value = "";
      document.getElementById("webhookUrlInput").placeholder = "https://discord.com/api/webhooks/…";
      state.settings.webhookConfigured = false;
      updateWebhookDot();
      renderMonitorStatus();
      var statusEl = document.getElementById("webhookStatus");
      statusEl.className = "modal-status ok";
      statusEl.textContent = "Removed.";
    });
  }

  // ---------- events ----------
  function bindEvents() {
    document.getElementById("viewSwitch").addEventListener("click", function (e) {
      var btn = e.target.closest(".view-tab");
      if (!btn) return;
      switchView(btn.getAttribute("data-view"));
    });

    document.getElementById("chainTabs").addEventListener("click", function (e) {
      var btn = e.target.closest(".chain-tab");
      if (!btn) return;
      switchChain(btn.getAttribute("data-chain"), false);
    });

    document.getElementById("feedTabs").addEventListener("click", function (e) {
      var btn = e.target.closest(".feed-tab");
      if (!btn) return;
      state.feed = btn.getAttribute("data-feed");
      document.querySelectorAll(".feed-tab").forEach(function (b) { b.classList.toggle("active", b === btn); });
      state.searchActive = false;
      document.getElementById("searchInput").value = "";
      updateSortOptions(state.feed);
      refreshCoinList(false);
    });

    document.getElementById("sortSelect").addEventListener("change", function (e) {
      state.sort = e.target.value;
      if (state.currentRows && state.currentRows.length) renderRows(state.currentRows.slice().sort(SORT_FNS[state.sort]));
    });

    document.getElementById("refreshBtn").addEventListener("click", function () {
      var icon = document.getElementById("refreshBtn");
      icon.classList.add("spinning");
      var done = function () { icon.classList.remove("spinning"); };
      (state.searchActive ? doSearch() : refreshCoinList(false)).then(done).catch(done);
    });

    document.getElementById("nftRefreshBtn").addEventListener("click", function () {
      var icon = document.getElementById("nftRefreshBtn");
      icon.classList.add("spinning");
      ensureNftLoaded(state.chain).then(function () { icon.classList.remove("spinning"); }).catch(function () { icon.classList.remove("spinning"); });
    });

    document.getElementById("searchBtn").addEventListener("click", doSearch);
    document.getElementById("searchInput").addEventListener("keydown", function (e) { if (e.key === "Enter") doSearch(); });

    document.getElementById("coinList").addEventListener("click", function (e) {
      var btn = e.target.closest("[data-action]");
      if (!btn) return;
      var addr = btn.getAttribute("data-address");
      if (btn.getAttribute("data-action") === "copy") copyAddress(addr);
      if (btn.getAttribute("data-action") === "discord") sendCoinToDiscord(addr);
    });

    document.getElementById("nftList").addEventListener("click", function (e) {
      var prevBtn = e.target.closest('[data-nft-action="preview"]');
      if (prevBtn) { toggleNftPreview(prevBtn.getAttribute("data-address")); return; }
      var discBtn = e.target.closest('[data-nft-action="discord"]');
      if (discBtn) sendNftToDiscord(discBtn.getAttribute("data-address"));
    });

    document.getElementById("openSettings").addEventListener("click", openSettingsModal);
    document.getElementById("closeSettings").addEventListener("click", closeSettingsModal);
    document.getElementById("settingsOverlay").addEventListener("click", function (e) { if (e.target.id === "settingsOverlay") closeSettingsModal(); });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeSettingsModal(); });
    document.getElementById("saveThreshold").addEventListener("click", saveThreshold);
    document.getElementById("saveWebhook").addEventListener("click", saveWebhook);
    document.getElementById("testWebhook").addEventListener("click", testWebhook);
    document.getElementById("clearWebhook").addEventListener("click", clearWebhook);
    document.getElementById("toggleWebhookVisibility").addEventListener("click", function () {
      var input = document.getElementById("webhookUrlInput");
      input.type = input.type === "password" ? "text" : "password";
    });

    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "visible") backgroundPoll();
    });
  }

  // ---------- background polling (keeps data "real-time" without a full reload) ----------
  function backgroundPoll() {
    if (document.visibilityState !== "visible") return;
    if (!state.searchActive) refreshCoinList(true);
    loadSettings();
  }
  setInterval(backgroundPoll, POLL_MS);

  // ---------- init ----------
  function init() {
    bindEvents();
    Promise.all([loadChains(), loadSettings()]).then(function () {
      renderChainTabs();
      updateChainUI();
      updateSortOptions(state.feed);
      switchChain("ethereum", false);
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
