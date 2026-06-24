import { describe, expect, it } from "vitest";
import { applyMainnetSmallSwapGasMode } from "./intent-swap-types.js";

describe("applyMainnetSmallSwapGasMode", () => {
  it("switches gasless to best price for mainnet amounts under $20 (6-decimal stablecoins)", () => {
    const requote = {
      fromChain: 1,
      toChain: 1,
      tokenIn: "0xusdc",
      tokenOut: "0xweth",
      amount: "2000000",
      executionMode: "gasless" as const,
    };
    expect(applyMainnetSmallSwapGasMode(requote)?.executionMode).toBe("any");
  });

  it("leaves base unchanged", () => {
    const requote = {
      fromChain: 8453,
      toChain: 8453,
      tokenIn: "0xusdc",
      tokenOut: "0xweth",
      amount: "2000000",
      executionMode: "any" as const,
    };
    expect(applyMainnetSmallSwapGasMode(requote)?.executionMode).toBe("any");
  });
});
