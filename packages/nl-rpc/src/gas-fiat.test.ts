import { describe, expect, it } from "vitest";
import { isGasFiatQuery, matchGasFiatQuery } from "./gas-fiat.js";

describe("gas-fiat", () => {
  it("matches gas priced in USDT phrasing", () => {
    expect(isGasFiatQuery("how much in usdt is eth gas right now")).toBe(true);
    expect(isGasFiatQuery("how mush in usdt is eth gas right now")).toBe(true);
    expect(isGasFiatQuery("eth gas in usdt")).toBe(true);
  });

  it("does not match plain gas price", () => {
    expect(isGasFiatQuery("gas price on eth")).toBe(false);
  });

  it("does not match swaps", () => {
    expect(isGasFiatQuery("swap eth gas in usdt")).toBe(false);
  });

  it("builds __gas_fiat__ intent", () => {
    const intent = matchGasFiatQuery("how much in usdt is eth gas right now", "eth");
    expect(intent?.method).toBe("__gas_fiat__");
    expect(intent?.params).toEqual(["eth", "usd", "USDT"]);
  });
});
