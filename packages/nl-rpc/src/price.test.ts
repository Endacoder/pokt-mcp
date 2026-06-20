import { describe, expect, it } from "vitest";
import { fetchSpotPrice, matchPriceChangeQuery, matchSpotPriceQuery } from "./price.js";

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
    expect(intent?.method).toBe("__price_change_24h__");
    expect(intent?.params[0]).toBe("bitcoin");
    expect(intent?.params[1]).toBe("BTC");
  });

  it("matches eth 24h change", () => {
    const intent = matchPriceChangeQuery("eth 24h change", "eth");
    expect(intent?.method).toBe("__price_change_24h__");
    expect(intent?.params[1]).toBe("ETH");
  });

  it("does not match unrelated queries", () => {
    expect(matchPriceChangeQuery("latest block on base", "eth")).toBeNull();
  });
});

describe("fetchSpotPrice stablecoin vs", () => {
  it("maps usdt to usd for coingecko", async () => {
    const result = await fetchSpotPrice("bitcoin", "BTC", "usdt", "USDT");
    expect(result.vsCurrency).toBe("usd");
    expect(result.price).toBeGreaterThan(0);
  });
});
