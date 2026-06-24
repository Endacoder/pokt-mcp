import { describe, expect, it } from "vitest";
import { createNlRpcEngine } from "./index.js";
import {
  executeMarketAnalyticsUnsupported,
  formatMarketAnalyticsUnsupported,
  isMarketAnalyticsQuery,
  matchMarketAnalyticsQuery,
} from "./market-analytics.js";

describe("market analytics", () => {
  it("matches asset trading volume queries", () => {
    expect(isMarketAnalyticsQuery("what volume of trade has btc been doing last 3 days")).toBe(true);
    const intent = matchMarketAnalyticsQuery("what volume of trade has btc been doing last 3 days");
    expect(intent?.method).toBe("__asset_trading_volume__");
    expect(intent?.params).toEqual(["bitcoin", "BTC", 3]);
  });

  it("matches most traded token queries", () => {
    expect(
      isMarketAnalyticsQuery("in the last 24 hours what has been the most traded token on ETH chain"),
    ).toBe(true);
    expect(matchMarketAnalyticsQuery("top traded token on ethereum")?.method).toBe(
      "__market_analytics_unsupported__",
    );
  });

  it("does not match unrelated queries", () => {
    expect(isMarketAnalyticsQuery("latest block on eth")).toBe(false);
    expect(isMarketAnalyticsQuery("what chains are supported")).toBe(false);
  });

  it("returns structured unsupported message", () => {
    const result = executeMarketAnalyticsUnsupported("Ethereum Mainnet");
    expect(result.queryType).toBe("token_trading_volume");
    expect(result.message).toContain("indexed DEX or market data");
    expect(result.suggestions.length).toBeGreaterThan(0);
    expect(formatMarketAnalyticsUnsupported(result)).toContain("Try instead:");
  });

  it("parses via nl-rpc engine", async () => {
    const engine = createNlRpcEngine({ llm: null });
    const parsed = await engine.parse(
      "in the last 24 hours what has been the most traded token on ETH chain",
    );
    expect(parsed.intent.method).toBe("__market_analytics_unsupported__");
    expect(parsed.intent.method).not.toBe("__list_chains__");
  });
});
