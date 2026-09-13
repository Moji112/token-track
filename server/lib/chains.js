"use strict";

const DEX_API = "https://api.dexscreener.com";

const CHAINS = {
  ethereum: {
    key: "ethereum",
    label: "Ethereum",
    dexId: "ethereum",
    explorerUrl: "https://eth.blockscout.com",
    explorerLabel: "Blockscout — Ethereum mainnet",
    note:
      "The original smart-contract chain — deepest liquidity and longest history, but the biggest playground for scams simply because of the volume passing through it. Data here is pulled from Blockscout's free Ethereum mirror rather than Etherscan (Etherscan's API needs a personal key) — \"View on explorer\" links still point to Etherscan itself.",
    discordColor: 0x5b6ee8,
  },
  ink: {
    key: "ink",
    label: "Ink",
    dexId: "ink",
    explorerUrl: "https://explorer.inkonchain.com",
    explorerLabel: "Ink Explorer",
    note:
      "Kraken's Ethereum layer-2 (chain ID 57073). Markets here are thinner than Ethereum's, so check liquidity carefully before trusting a price.",
    discordColor: 0x6b4a94,
  },
  robinhood: {
    key: "robinhood",
    label: "Robinhood Chain",
    dexId: "robinhood",
    explorerUrl: "https://robinhoodchain.blockscout.com",
    explorerLabel: "Robinhood Chain Explorer",
    note:
      "Robinhood's layer-2 (chain ID 4663), live on mainnet since July 2026. Very young — most tokens here are days or weeks old, and meme coins have driven most of the activity so far.",
    warn:
      "Heads up: lookalike \"explorer\" sites for Robinhood Chain (domains like robinscan.xyz, hoodexplorer.com, rhexplorer.info/.com) have shown up and are not official. The real one is robinhoodchain.blockscout.com — check the domain before you ever connect a wallet.",
    discordColor: 0x1fa85c,
  },
  solana: {
    key: "solana",
    label: "Solana",
    dexId: "solana",
    isEvm: false,
    supportsBlockscout: false, // Blockscout is EVM-only — Solana has no holder-sorted "Most held" source here
    explorerUrl: "https://solscan.io",
    explorerLabel: "Solscan",
    note:
      "A non-EVM chain, so the \"Most held\" tab (which relies on an EVM Blockscout explorer) isn't available here — use Freshly listed or Trending now instead, both sourced live from DexScreener. Solana's fees are tiny and its meme-coin volume is enormous, which cuts both ways: fast markets, and just as fast rug pulls.",
    discordColor: 0x14f195,
  },
  base: {
    key: "base",
    label: "Base",
    dexId: "base",
    explorerUrl: "https://base.blockscout.com",
    explorerLabel: "Blockscout — Base",
    note:
      "Coinbase's OP Stack layer-2 (chain ID 8453). Coinbase's own on/off-ramp makes it one of the easiest chains for a beginner to actually get funds onto — which also makes it a common target for tokens and NFTs impersonating well-known brands.",
    discordColor: 0x0052ff,
  },
};

const NFT_INFO = {
  ethereum: {
    body:
      "Ethereum has by far the deepest NFT markets of the three. The list above is every ERC-721/1155 contract Blockscout has indexed, sorted by holders — for floor prices and curated collections, a marketplace is still your best bet.",
    links: [
      { label: "OpenSea", url: "https://opensea.io" },
      { label: "Blur", url: "https://blur.io" },
    ],
  },
  ink: {
    body:
      "Ink's NFT scene is new and still forming. The list above is live from Ink's own explorer. For a curated view of what's actually being used, Ink's own app directory is a good second stop.",
    links: [{ label: "Ink app directory", url: "https://inkonchain.com/apps" }],
  },
  robinhood: {
    body:
      "Robinhood Chain's activity so far is mostly meme coins, tokenized stocks, and DeFi — we couldn't confirm a dedicated NFT marketplace live yet. The list above is whatever ERC-721/1155 contracts the official explorer has indexed; treat anything here as unverified until you check further.",
    links: [],
  },
  solana: {
    body:
      "Solana NFTs (\"compressed\" or otherwise) don't go through Blockscout, so there's no live contract list here yet — Magic Eden and Tensor are the two marketplaces most Solana activity actually happens on.",
    links: [
      { label: "Magic Eden", url: "https://magiceden.io" },
      { label: "Tensor", url: "https://www.tensor.trade" },
    ],
  },
  base: {
    body:
      "Base has real NFT activity, much of it through Zora. The list above is every ERC-721/1155 contract Blockscout has indexed here, sorted by holders — for curated collections and floor prices, check the marketplaces directly.",
    links: [
      { label: "Zora", url: "https://zora.co" },
      { label: "OpenSea", url: "https://opensea.io" },
    ],
  },
};

function explorerAddressUrl(chainKey, address) {
  if (chainKey === "ethereum") return "https://etherscan.io/address/" + address;
  if (chainKey === "solana") return "https://solscan.io/token/" + address;
  return CHAINS[chainKey].explorerUrl + "/address/" + address;
}

/** EVM addresses are case-insensitive (safe to normalize); Solana's base58 addresses are not. */
function normalizeAddress(chainKey, address) {
  if (!address) return "";
  var chain = CHAINS[chainKey];
  return chain && chain.isEvm === false ? address : address.toLowerCase();
}

module.exports = { CHAINS, NFT_INFO, DEX_API, explorerAddressUrl, normalizeAddress };
