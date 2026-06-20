import { describe, expect, it } from "vitest";
import {
  formatIntentMcpQuoteError,
  formatQuoteAnswer,
  formatSwapParseFailureMessage,
  normalizeSwapTokenHit,
  parseSwapExecutionQuery,
  resolveSwapExecutionMode,
  resolveSwapTokenSearchQuery,
} from "./intent-swap.js";

describe("parseSwapExecutionQuery", () => {
  it("parses swap X for Y", () => {
    expect(parseSwapExecutionQuery("swap 1 usdt for eth")).toEqual({
      amountHuman: "1",
      tokenInSymbol: "usdt",
      tokenOutSymbol: "eth",
      chainHint: undefined,
    });
  });

  it("parses swap with chain hint", () => {
    expect(parseSwapExecutionQuery("swap 50 USDC to ETH on Base")).toEqual({
      amountHuman: "50",
      tokenInSymbol: "USDC",
      tokenOutSymbol: "ETH",
      chainHint: "Base",
    });
  });

  it("returns null for non-swap text", () => {
    expect(parseSwapExecutionQuery("latest block on eth")).toBeNull();
  });

  it("returns null for swap without amount", () => {
    expect(parseSwapExecutionQuery("swap to USDT")).toBeNull();
    expect(parseSwapExecutionQuery("swap ETH to USDT")).toBeNull();
  });
});

describe("resolveSwapExecutionMode", () => {
  it("defaults to best price (any)", () => {
    expect(resolveSwapExecutionMode({})).toBe("any");
  });

  it("honors gas selection", () => {
    expect(resolveSwapExecutionMode({ swapExecutionMode: "gas" })).toBe("gas");
  });

  it("honors gasless selection", () => {
    expect(resolveSwapExecutionMode({ swapExecutionMode: "gasless" })).toBe("gasless");
  });
});

describe("resolveSwapTokenSearchQuery", () => {
  it("maps ETH to WETH for token search", () => {
    expect(resolveSwapTokenSearchQuery("ETH")).toBe("WETH");
    expect(resolveSwapTokenSearchQuery("usdc")).toBe("usdc");
  });

  it("maps POL and MATIC to WMATIC for token search", () => {
    expect(resolveSwapTokenSearchQuery("POL")).toBe("WMATIC");
    expect(resolveSwapTokenSearchQuery("matic")).toBe("WMATIC");
  });
});

describe("formatIntentMcpQuoteError", () => {
  it("adds swap context and guidance for no-quotes errors", () => {
    const message = formatIntentMcpQuoteError(new Error("No quotes available for this swap. Check token pair and chains."), {
      chainName: "Base",
      amountHuman: "50",
      tokenInSymbol: "USDC",
      tokenOutSymbol: "ETH",
      tokenIn: { address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", symbol: "USDC", decimals: 6 },
      tokenOut: { address: "0x4200000000000000000000000000000000000006", symbol: "WETH", decimals: 18 },
      transport: "mcp-remote",
      transportLabel: "https://mcp.metalift.ai/mcp",
    });

    expect(message).toContain("Attempted: 50 USDC → ETH on Base");
    expect(message).toContain("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913");
    expect(message).toContain("Cross-chain swaps are not supported");
    expect(message).toContain("https://mcp.metalift.ai/mcp");
  });
});

describe("normalizeSwapTokenHit", () => {
  it("corrects wrong decimals for ETH/WETH", () => {
    expect(
      normalizeSwapTokenHit(
        { address: "0xc02", symbol: "ETH", decimals: 9 },
        "ETH",
      ).decimals,
    ).toBe(18);
  });
});

describe("formatSwapParseFailureMessage", () => {
  it("guides swap to TOKEN with native default", () => {
    expect(formatSwapParseFailureMessage("swap to USDT")).toContain(
      "swap 1 ETH to USDT",
    );
  });

  it("guides swap TOKEN to TOKEN without amount", () => {
    expect(formatSwapParseFailureMessage("swap my ETH to USDT")).toBe(
      "How much ETH do you want to swap to USDT? Example: swap 1 ETH to USDT",
    );
  });

  it("falls back for unrelated text", () => {
    expect(formatSwapParseFailureMessage("latest block on eth")).toContain(
      "Could not parse swap request",
    );
  });
});

describe("formatQuoteAnswer", () => {
  const quote = {
    quoteId: "q_test",
    expiresAt: "2026-06-20T06:48:46.588Z",
    route: "Intent route on Ethereum",
    routeType: "same-chain",
    fromChain: 1,
    toChain: 1,
    tokenIn: { address: "0xusdt", symbol: "USDT", amount: "1000000" },
    tokenOut: { address: "0xweth", symbol: "WETH", amountEstimated: "468060000000000" },
    platformFeeBps: 25,
    executionMode: "gasless",
    gasEstimateUsd: 0,
    warnings: ["Quote expires in 60 seconds", "Gasless route — fillers/solvers pay network gas"],
  };
  const tokenIn = { address: "0xusdt", symbol: "USDT", decimals: 6 };
  const tokenOut = { address: "0xweth", symbol: "WETH", decimals: 18 };
  const parsed = {
    amountHuman: "1",
    tokenInSymbol: "USDT",
    tokenOutSymbol: "ETH",
  };

  it("formats markdown with line breaks and ETH label", () => {
    const text = formatQuoteAnswer(parsed, tokenIn, tokenOut, quote, "Ethereum Mainnet");
    expect(text).toContain("### Swap quote · Ethereum Mainnet");
    expect(text).toContain("**1 USDT** → **~0.00046806 ETH**");
    expect(text).toContain("- **Execution:** Gasless (solver pays gas)");
    expect(text).toContain("- **Gas:** Gasless");
    expect(text).not.toContain("Warnings: Quote expires");
  });
});
