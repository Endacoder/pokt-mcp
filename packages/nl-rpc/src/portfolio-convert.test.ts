import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { convertWalletPortfolio, formatPortfolioConversion } from "./portfolio-convert.js";
import type { WalletPortfolioSnapshot } from "@pokt-mcp/shared";

const portfolio: WalletPortfolioSnapshot = {
  address: "0xae8609a54a52501bb76c104d920efab7f52a6bcb",
  chains: [
    {
      chain: "eth",
      chainName: "Ethereum Mainnet",
      nativeSymbol: "ETH",
      nativeBalance: "0.000152",
      tokens: [],
    },
    {
      chain: "base",
      chainName: "Base",
      nativeSymbol: "ETH",
      nativeBalance: "0.000001",
      tokens: [{ symbol: "USDC", balance: "0.071581" }],
    },
  ],
};

describe("convertWalletPortfolio", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn(async () =>
      Response.json({
        ethereum: { usd: 2000 },
      }),
    ) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("sums native and stablecoin balances in USD", async () => {
    const result = await convertWalletPortfolio(portfolio, "usd", "USD");
    expect(result.totalUsd).toBeCloseTo(0.000152 * 2000 + 0.000001 * 2000 + 0.071581, 4);
    expect(result.lines.length).toBe(2);
  });

  it("formats a multi-chain USD summary", async () => {
    const result = await convertWalletPortfolio(portfolio, "usd", "USD");
    const text = formatPortfolioConversion(result);
    expect(text).toContain("across 2 chains");
    expect(text).toContain("Base");
    expect(text).toContain("USDC");
  });
});
