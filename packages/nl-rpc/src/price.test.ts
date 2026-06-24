import { describe, expect, it } from "vitest";
import {
  fetchSpotPrice,
  matchPriceChangeFollowUp,
  matchPriceChangeQuery,
  matchSpotPriceQuery,
  matchUnsupportedMarketPeriodQuery,
  parsePriceChangePeriod,
} from "./price.js";

describe("matchSpotPriceQuery", () => {
  it("matches POLY spot price", () => {
    const intent = matchSpotPriceQuery("what is the price of POLY", "eth");
    expect(intent?.method).toBe("__spot_price__");
    expect(intent?.params[1]).toBe("POL");
    expect(intent?.params[3]).toBe("USD");
  });

  it("matches price of ethereum", () => {
    const intent = matchSpotPriceQuery("price of ethereum", "eth");
    expect(intent?.method).toBe("__spot_price__");
    expect(intent?.params[1]).toBe("ETH");
  });

  it("matches eth price in btc", () => {
    const intent = matchSpotPriceQuery("eth price in btc", "eth");
    expect(intent?.params[2]).toBe("btc");
    expect(intent?.params[3]).toBe("BTC");
  });

  it("matches price of polygon as POL", () => {
    const intent = matchSpotPriceQuery("price of polygon", "eth");
    expect(intent?.method).toBe("__spot_price__");
    expect(intent?.params[0]).toBe("polygon-ecosystem-token");
    expect(intent?.params[1]).toBe("POL");
  });

  it("matches how much is polygon worth", () => {
    const intent = matchSpotPriceQuery("how much is polygon worth", "poly");
    expect(intent?.method).toBe("__spot_price__");
    expect(intent?.params[1]).toBe("POL");
  });

  it("does not match gas price queries", () => {
    expect(matchSpotPriceQuery("gas price on polygon", "poly")).toBeNull();
    expect(matchSpotPriceQuery("what is the gas price on eth", "eth")).toBeNull();
  });

  it("matches what is btc price right now", () => {
    const intent = matchSpotPriceQuery("what is btc price right now", "eth");
    expect(intent?.method).toBe("__spot_price__");
    expect(intent?.params[1]).toBe("BTC");
  });
});

describe("matchPriceChangeQuery", () => {
  it("matches avg change in btc in 24 hrs", () => {
    const intent = matchPriceChangeQuery("what is the avg change in btc in 24 hrs", "eth");
    expect(intent?.method).toBe("__price_change__");
    expect(intent?.params[0]).toBe("bitcoin");
    expect(intent?.params[1]).toBe("BTC");
    expect(intent?.params[2]).toBe("24h");
  });

  it("matches eth 24h change", () => {
    const intent = matchPriceChangeQuery("eth 24h change", "eth");
    expect(intent?.method).toBe("__price_change__");
    expect(intent?.params[1]).toBe("ETH");
    expect(intent?.params[2]).toBe("24h");
  });

  it("matches how has btc been doing", () => {
    const intent = matchPriceChangeQuery("how has btc been doing", "eth");
    expect(intent?.method).toBe("__price_change__");
    expect(intent?.params[1]).toBe("BTC");
    expect(intent?.params[2]).toBe("24h");
  });

  it("matches 7d change from expanded follow-up text", () => {
    const intent = matchPriceChangeQuery(
      'Previous: "how has btc been doing" | Follow-up: how about in a week',
      "eth",
    );
    expect(intent?.method).toBe("__price_change__");
    expect(intent?.params[1]).toBe("BTC");
    expect(intent?.params[2]).toBe("7d");
  });

  it("parses for the week as 7d", () => {
    expect(parsePriceChangePeriod("how about for the week")).toBe("7d");
  });

  it("does not match unrelated queries", () => {
    expect(matchPriceChangeQuery("latest block on base", "eth")).toBeNull();
  });
});

describe("matchPriceChangeFollowUp", () => {
  it("uses session lastMarketQuery for vague week follow-up", () => {
    const intent = matchPriceChangeFollowUp("how about in a week", "eth", {
      lastMarketQuery: {
        symbol: "BTC",
        coingeckoId: "bitcoin",
        kind: "priceChange",
        period: "24h",
      },
    });
    expect(intent?.method).toBe("__price_change__");
    expect(intent?.params[2]).toBe("7d");
  });

  it("uses session lastMarketQuery for in 1 week follow-up", () => {
    const intent = matchPriceChangeFollowUp("in 1 week", "eth", {
      lastMarketQuery: {
        symbol: "ETH",
        coingeckoId: "ethereum",
        kind: "priceChange",
        period: "24h",
      },
    });
    expect(intent?.method).toBe("__price_change__");
    expect(intent?.params).toEqual(["ethereum", "ETH", "7d"]);
  });

  it("spot price session to in 1 week change follow-up", () => {
    const intent = matchPriceChangeFollowUp("in 1 week", "eth", {
      lastMarketQuery: {
        symbol: "ETH",
        coingeckoId: "ethereum",
        kind: "spotPrice",
      },
    });
    expect(intent?.method).toBe("__price_change__");
    expect(intent?.params).toEqual(["ethereum", "ETH", "7d"]);
  });

  it("does not guess period for unmapped explicit duration", () => {
    const intent = matchPriceChangeFollowUp("in 3 days", "eth", {
      lastMarketQuery: {
        symbol: "ETH",
        coingeckoId: "ethereum",
        kind: "priceChange",
        period: "7d",
      },
    });
    expect(intent).toBeNull();
  });

  it("routes unmapped duration to unsupported market period intent", () => {
    const intent = matchUnsupportedMarketPeriodQuery("in 3 days", "in 3 days", {
      lastMarketQuery: {
        symbol: "ETH",
        coingeckoId: "ethereum",
        kind: "priceChange",
        period: "7d",
      },
    });
    expect(intent?.method).toBe("__unsupported_market_period__");
    expect(intent?.params).toEqual(["in 3 days", "ETH"]);
  });

  it("cross-asset from how about eth", () => {
    const intent = matchPriceChangeFollowUp("how about eth", "eth", {
      lastMarketQuery: {
        symbol: "BTC",
        coingeckoId: "bitcoin",
        kind: "priceChange",
        period: "24h",
      },
    });
    expect(intent?.params[0]).toBe("ethereum");
    expect(intent?.params[1]).toBe("ETH");
  });
});

describe("fetchSpotPrice stablecoin vs", () => {
  it("maps usdt to usd for coingecko", async () => {
    const result = await fetchSpotPrice("bitcoin", "BTC", "usdt", "USDT");
    expect(result.vsCurrency).toBe("usd");
    expect(result.price).toBeGreaterThan(0);
  });
});
