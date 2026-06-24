import type { SessionContext } from "@pokt-mcp/shared";
import type { ParseScenario } from "./types.js";
import { inferChain } from "../patterns.js";

/** Canonical assets for combinatorial market scenarios. */
const ASSETS = [
  { alias: "btc", coingeckoId: "bitcoin", symbol: "BTC" },
  { alias: "eth", coingeckoId: "ethereum", symbol: "ETH" },
  { alias: "sol", coingeckoId: "solana", symbol: "SOL" },
  { alias: "doge", coingeckoId: "dogecoin", symbol: "DOGE" },
  { alias: "avax", coingeckoId: "avalanche-2", symbol: "AVAX" },
  { alias: "bnb", coingeckoId: "binancecoin", symbol: "BNB" },
  { alias: "matic", coingeckoId: "polygon-ecosystem-token", symbol: "POL" },
  { alias: "link", coingeckoId: "chainlink", symbol: "LINK" },
  { alias: "xrp", coingeckoId: "ripple", symbol: "XRP" },
  { alias: "ftm", coingeckoId: "fantom", symbol: "FTM" },
  { alias: "celo", coingeckoId: "celo", symbol: "CELO" },
  { alias: "bera", coingeckoId: "berachain", symbol: "BERA" },
  { alias: "mnt", coingeckoId: "mantle", symbol: "MNT" },
  { alias: "dai", coingeckoId: "dai", symbol: "DAI" },
] as const;

const FOLLOW_UP_STEMS = [
  "",
  "how about ",
  "what about ",
  "and for ",
  "how about in ",
  "what about in ",
  "same for ",
  "now for ",
];

const CROSS_STEMS = ["how about", "what about", "same for", "now for"];

const WALLET = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";

const RPC_CHAINS = ["eth", "base", "poly", "arb-one", "opt", "avax", "bsc", "gnosis", "fantom", "celo"];

function withStems(bases: string[], stems: string[]): string[] {
  const out: string[] = [];
  for (const base of bases) {
    out.push(base);
    for (const stem of stems) {
      if (!stem) continue;
      out.push(`${stem}${base}`.trim());
    }
  }
  return out;
}

function marketSession(
  asset: typeof ASSETS[number],
  kind: "priceChange" | "spotPrice",
  period?: "24h",
): SessionContext {
  if (kind === "spotPrice") {
    return {
      lastMarketQuery: {
        symbol: asset.symbol,
        coingeckoId: asset.coingeckoId,
        kind: "spotPrice",
      },
    };
  }
  return {
    lastMarketQuery: {
      symbol: asset.symbol,
      coingeckoId: asset.coingeckoId,
      kind: "priceChange",
      period: period ?? "24h",
    },
  };
}

function addMarketPeriodFollowUps(scenarios: ParseScenario[], seen: Set<string>): void {
  const weekBases = [
    "in 1 week",
    "in a week",
    "for the week",
    "past 7 days",
    "last 7 days",
    "7 days",
    "7d",
    "this week",
    "last week",
    "past week",
    "the week",
    "over the last week",
    "for the past week",
    "in 7 days",
  ];
  const monthBases = [
    "in 1 month",
    "in a month",
    "for the month",
    "past month",
    "last month",
    "30 days",
    "past 30 days",
    "over the last month",
    "for the past month",
    "this month",
    "the month",
    "in 30 days",
  ];
  const dayBases = [
    "24h",
    "24 hours",
    "in 24 hours",
    "last day",
    "past day",
    "since yesterday",
    "today",
  ];
  const twoWeekBases = [
    "in 2 weeks",
    "two weeks",
    "past two weeks",
    "in 14 days",
    "14 days",
    "last 14 days",
    "past 14 days",
  ];
  const yearBases = [
    "ytd",
    "year to date",
    "past year",
    "last year",
    "this year",
    "in 1 year",
    "in a year",
    "over the year",
    "1y",
  ];

  const periodSets: Array<{ bases: string[]; period: "7d" | "30d" | "24h" | "14d" | "1y" }> = [
    { bases: weekBases, period: "7d" },
    { bases: monthBases, period: "30d" },
    { bases: dayBases, period: "24h" },
    { bases: twoWeekBases, period: "14d" },
    { bases: yearBases, period: "1y" },
  ];

  for (const asset of ASSETS) {
    for (const { bases, period } of periodSets) {
      const queries = withStems(bases, FOLLOW_UP_STEMS);
      for (const query of queries) {
        for (const kind of ["priceChange", "spotPrice"] as const) {
          const key = `mkt|${asset.alias}|${kind}|${period}|${query}`;
          if (seen.has(key)) continue;
          seen.add(key);
          scenarios.push({
            id: `mkt-period-${scenarios.length}`,
            query,
            sessionContext: marketSession(asset, kind),
            expectMethod: "__price_change__",
            expectParams: [asset.coingeckoId, asset.symbol, period],
          });
        }
      }
    }
  }
}

function addCrossAssetFollowUps(scenarios: ParseScenario[], seen: Set<string>): void {
  for (const sessionAsset of ASSETS) {
    for (const other of ASSETS) {
      if (other.alias === sessionAsset.alias) continue;
      for (const stem of CROSS_STEMS) {
        const query = `${stem} ${other.alias}`;
        const key = `cross|${sessionAsset.alias}|${other.alias}|${stem}`;
        if (seen.has(key)) continue;
        seen.add(key);
        scenarios.push({
          id: `cross-${scenarios.length}`,
          query,
          sessionContext: marketSession(sessionAsset, "priceChange"),
          expectMethod: "__price_change__",
          expectParams: [other.coingeckoId, other.symbol, "24h"],
        });
      }
    }
  }
}

function addPerformanceQueries(scenarios: ParseScenario[], seen: Set<string>): void {
  const templates = [
    (a: string) => `how has ${a} been doing`,
    (a: string) => `how is ${a} performing`,
    (a: string) => `${a} trend`,
    (a: string) => `is ${a} up or down`,
    (a: string) => `${a} rally`,
    (a: string) => `${a} correction`,
    (a: string) => `how is ${a} doing`,
    (a: string) => `is ${a} rising`,
    (a: string) => `is ${a} falling`,
    (a: string) => `${a} pump or dump`,
  ];

  for (const asset of ASSETS) {
    for (const tmpl of templates) {
      const query = tmpl(asset.alias);
      const key = `perf|${query}`;
      if (seen.has(key)) continue;
      seen.add(key);
      scenarios.push({
        id: `perf-${scenarios.length}`,
        query,
        expectMethod: "__price_change__",
        expectParams: [asset.coingeckoId, asset.symbol, "24h"],
      });
    }
  }
}

function addSpotPriceQueries(scenarios: ParseScenario[], seen: Set<string>): void {
  const templates = [
    (a: string) => `price of ${a}`,
    (a: string) => `what is ${a} price`,
    (a: string) => `${a} price`,
    (a: string) => `what's the price of ${a}`,
    (a: string) => `how much is ${a} worth`,
    (a: string) => `current price of ${a}`,
    (a: string) => `what was price of ${a}`,
    (a: string) => `${a} spot price`,
  ];

  for (const asset of ASSETS) {
    for (const tmpl of templates) {
      const query = tmpl(asset.alias);
      const key = `spot|${query}`;
      if (seen.has(key)) continue;
      seen.add(key);
      scenarios.push({
        id: `spot-${scenarios.length}`,
        query,
        expectMethod: "__spot_price__",
        expectParams: [asset.coingeckoId, asset.symbol, "usd", "USD"],
      });
    }
  }
}

const CHAIN_NUMERIC_ALIASES = new Set(["1", "10", "56", "100", "137", "250", "324"]);

function addTemporalFollowUps(scenarios: ParseScenario[], seen: Set<string>): void {
  const offsetPhrases: string[] = [];
  for (let h = 1; h <= 24; h++) {
    if (CHAIN_NUMERIC_ALIASES.has(String(h))) continue;
    const unit = h === 1 ? "hour" : "hours";
    offsetPhrases.push(`${h} ${unit} ago`);
    offsetPhrases.push(`what was it ${h} ${unit} ago`);
    offsetPhrases.push(`back then ${h} ${unit} ago`);
  }
  for (let d = 1; d <= 14; d++) {
    if (CHAIN_NUMERIC_ALIASES.has(String(d))) continue;
    const unit = d === 1 ? "day" : "days";
    offsetPhrases.push(`${d} ${unit} ago`);
    offsetPhrases.push(`what was it ${d} ${unit} ago`);
  }
  offsetPhrases.push("yesterday", "last hour", "last week", "and yesterday", "what was it yesterday");

  const sessions: Array<{
    tag: string;
    session: SessionContext;
    method: string;
    prefix: (offsetSec: number) => unknown[];
  }> = [
    {
      tag: "gas",
      session: {
        lastQuery: { chain: "eth", method: "eth_gasPrice", subject: "gas", params: [] },
      },
      method: "__query_at_time__",
      prefix: (s) => ["eth", "gas", s],
    },
    {
      tag: "bal",
      session: {
        lastQuery: {
          chain: "eth",
          method: "eth_getBalance",
          subject: "balance",
          params: [WALLET],
        },
      },
      method: "__query_at_time__",
      prefix: (s) => ["eth", "balance", s],
    },
    {
      tag: "block",
      session: {
        lastQuery: { chain: "eth", method: "eth_blockNumber", subject: "blockNumber", params: [] },
      },
      method: "__query_at_time__",
      prefix: (s) => ["eth", "blockNumber", s],
    },
  ];

  const offsetSecondsMap: Record<string, number> = {
    "1 hour ago": 3600,
    "2 hours ago": 7200,
    "3 hours ago": 10800,
    "6 hours ago": 21600,
    "12 hours ago": 43200,
    "24 hours ago": 86400,
    "1 day ago": 86400,
    "2 days ago": 172800,
    "3 days ago": 259200,
    "7 days ago": 604800,
    "14 days ago": 1209600,
    yesterday: 86400,
    "last hour": 3600,
    "last week": 604800,
    "and yesterday": 86400,
    "what was it yesterday": 86400,
  };

  for (let h = 1; h <= 24; h++) {
    offsetSecondsMap[`${h} hour ago`] = h * 3600;
    offsetSecondsMap[`${h} hours ago`] = h * 3600;
    offsetSecondsMap[`what was it ${h} hour ago`] = h * 3600;
    offsetSecondsMap[`what was it ${h} hours ago`] = h * 3600;
    offsetSecondsMap[`back then ${h} hour ago`] = h * 3600;
    offsetSecondsMap[`back then ${h} hours ago`] = h * 3600;
  }
  for (let d = 1; d <= 14; d++) {
    offsetSecondsMap[`${d} day ago`] = d * 86400;
    offsetSecondsMap[`${d} days ago`] = d * 86400;
    offsetSecondsMap[`what was it ${d} day ago`] = d * 86400;
    offsetSecondsMap[`what was it ${d} days ago`] = d * 86400;
  }

  for (const { tag, session, method, prefix } of sessions) {
    for (const phrase of offsetPhrases) {
      const sec = offsetSecondsMap[phrase];
      if (sec === undefined) continue;
      const key = `tmp|${tag}|${phrase}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const expectedChain = inferChain(phrase, session);
      scenarios.push({
        id: `tmp-${tag}-${scenarios.length}`,
        query: phrase,
        sessionContext: session,
        expectMethod: method,
        expectParamsPrefix: [expectedChain, ...prefix(sec).slice(1)],
      });
    }
  }
}

function addConvertFollowUps(scenarios: ParseScenario[], seen: Set<string>): void {
  const portfolioPhrases = withStems(
    [
      "what's that in USD",
      "how much is that in dollars",
      "value in usd",
      "worth in fiat",
      "in dollars",
      "in fiat",
      "how much is that",
      "what's that worth",
      "convert that",
    ],
    ["how about ", "what about "],
  );
  const targetPhrases = ["usd", "btc", "eth", "eur", "sol", "avax", "bnb"];

  const portfolio = {
    lastWalletPortfolio: {
      address: WALLET,
      chains: [
        {
          chain: "eth",
          chainName: "Ethereum",
          nativeSymbol: "ETH",
          nativeBalance: "1.0",
          tokens: [],
        },
      ],
    },
  };

  for (const phrase of portfolioPhrases) {
    for (const target of targetPhrases) {
      const query = phrase.includes("usd") || phrase.includes("dollar") || phrase.includes("fiat")
        ? phrase
        : `${phrase} in ${target}`;
      const key = `cvt-port|${query}`;
      if (seen.has(key)) continue;
      seen.add(key);
      scenarios.push({
        id: `cvt-port-${scenarios.length}`,
        query,
        sessionContext: portfolio,
        expectMethod: "__wallet_portfolio_convert__",
      });
    }
  }

  const balanceSession = {
    lastBalance: {
      chain: "eth",
      address: WALLET,
      wei: "0xde0b6b3a7640000",
    },
  };

  const balancePhrases = withStems(
    [
      "what's that in USD",
      "how much is that in dollars",
      "in dollars",
      "in fiat",
      "convert that",
      "how much is that",
      "what's that worth",
      "worth in usd",
      "value in usd",
    ],
    ["how about ", "what about "],
  );

  for (const phrase of balancePhrases) {
    const key = `cvt-bal|${phrase}`;
    if (seen.has(key)) continue;
    seen.add(key);
    scenarios.push({
      id: `cvt-bal-${scenarios.length}`,
      query: phrase,
      sessionContext: balanceSession,
      expectMethod: "__native_convert__",
    });
  }
}

function addRpcQueries(scenarios: ParseScenario[], seen: Set<string>): void {
  const templates: Array<{ fn: (chain: string) => string; method: string }> = [
    { fn: (c) => `latest block on ${c}`, method: "eth_blockNumber" },
    { fn: (c) => `gas price on ${c}`, method: "eth_gasPrice" },
    { fn: (c) => `current gas on ${c}`, method: "eth_gasPrice" },
    { fn: (c) => `blockchain height on ${c}`, method: "eth_blockNumber" },
    { fn: (c) => `chain id on ${c}`, method: "eth_chainId" },
    { fn: (c) => `network version on ${c}`, method: "net_version" },
  ];

  for (const chain of RPC_CHAINS) {
    for (const { fn, method } of templates) {
      const query = fn(chain);
      const key = `rpc|${query}`;
      if (seen.has(key)) continue;
      seen.add(key);
      scenarios.push({
        id: `rpc-${scenarios.length}`,
        query,
        expectMethod: method,
        expectChain: chain,
      });
    }
  }
}

function addHistoryFollowUps(scenarios: ParseScenario[], seen: Set<string>): void {
  const weekPhrases = ["in 1 week", "how about for the week", "in a week", "what about last month", "in 24 hours"];

  for (const asset of ASSETS) {
    for (const phrase of weekPhrases) {
      const period = phrase.includes("month") ? "30d" : phrase.includes("week") || phrase.includes("7") ? "7d" : "24h";
      const turns = [
        { role: "user" as const, content: `what was price of ${asset.alias}` },
        { role: "assistant" as const, content: `${asset.symbol} spot price: 100 USD` },
        { role: "user" as const, content: "in 24 hours" },
        { role: "assistant" as const, content: `${asset.symbol} 24h change: +1%` },
      ];
      const key = `hist|${asset.alias}|${phrase}`;
      if (seen.has(key)) continue;
      seen.add(key);
      scenarios.push({
        id: `hist-${scenarios.length}`,
        turns,
        query: phrase,
        expectMethod: "__price_change__",
        expectParams: [asset.coingeckoId, asset.symbol, period],
      });
    }
  }
}

/** Generate 10,000+ deterministic nl-rpc parse scenarios (no LLM). */
export function generateParseScenarios(): ParseScenario[] {
  const scenarios: ParseScenario[] = [];
  const seen = new Set<string>();

  addMarketPeriodFollowUps(scenarios, seen);
  addCrossAssetFollowUps(scenarios, seen);
  addPerformanceQueries(scenarios, seen);
  addSpotPriceQueries(scenarios, seen);
  addTemporalFollowUps(scenarios, seen);
  addConvertFollowUps(scenarios, seen);
  addRpcQueries(scenarios, seen);
  addHistoryFollowUps(scenarios, seen);

  return scenarios;
}

export const MIN_SCENARIO_COUNT = 10000;
