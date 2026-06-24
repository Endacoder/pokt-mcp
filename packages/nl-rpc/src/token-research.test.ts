import { describe, expect, it } from "vitest";
import { resolveKnownTokenAddress } from "./tokens.js";
import { matchTokenResearchQuery } from "./token-research.js";

describe("token research", () => {
  it("resolves USDC on eth from known tokens registry", () => {
    expect(resolveKnownTokenAddress("eth", "USDC")).toBe(
      "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    );
    expect(resolveKnownTokenAddress("eth", "usdc")).toBe(
      "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    );
    expect(resolveKnownTokenAddress("base", "USDC")).toBe(
      "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    );
    expect(resolveKnownTokenAddress("eth", "PEPE")).toBeUndefined();
  });

  it("passes USDC symbol from research query", () => {
    const intent = matchTokenResearchQuery("Research USDC on Ethereum");
    expect(intent?.params[2]).toBe("USDC");
    expect(intent?.params[1]).toBe("eth");
  });
});
