import { describe, expect, it } from "vitest";
import { isTokenQuoteQuery, matchConvertQuery, parseTargetAsset } from "./convert.js";
import type { WalletPortfolioSnapshot } from "@pokt-mcp/shared";

const samplePortfolio: WalletPortfolioSnapshot = {
  address: "0xae8609a54a52501bb76c104d920efab7f52a6bcb",
  scanned: 20,
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

describe("parseTargetAsset", () => {
  it("parses crypto targets", () => {
    expect(parseTargetAsset("how much in SOL")?.symbol).toBe("SOL");
    expect(parseTargetAsset("convert to matic")?.vs).toBe("pol");
    expect(parseTargetAsset("worth in polygon")?.symbol).toBe("POL");
  });

  it("parses fiat targets", () => {
    expect(parseTargetAsset("how much in USD")?.symbol).toBe("USD");
    expect(parseTargetAsset("how much in BTC")?.symbol).toBe("BTC");
  });
});

describe("matchConvertQuery", () => {
  it("matches USD follow-up using last balance context", () => {
    const intent = matchConvertQuery("whats that in USD", "eth", {
      lastBalance: {
        chain: "eth",
        address: "0xAE8609A54a52501bb76C104d920efaB7F52a6bcB",
        wei: "0x2234c3e8e8e8e8e8",
      },
    });
    expect(intent?.method).toBe("__native_convert__");
    expect(intent?.params[4]).toBe("USD");
  });

  it("uses portfolio convert after multi-chain balance query", () => {
    const intent = matchConvertQuery("whats that in USD", "eth", {
      lastWalletPortfolio: samplePortfolio,
      lastBalance: {
        chain: "eth",
        address: samplePortfolio.address,
        wei: "0x0",
      },
    });
    expect(intent?.method).toBe("__wallet_portfolio_convert__");
    expect(intent?.params[1]).toBe("usd");
    expect(intent?.params[2]).toBe("USD");
  });

  it("prefers portfolio over zero lastBalance wei", () => {
    const intent = matchConvertQuery("how much in USD", "eth", {
      lastWalletPortfolio: samplePortfolio,
    });
    expect(intent?.method).toBe("__wallet_portfolio_convert__");
  });

  it("matches BTC follow-up", () => {
    const intent = matchConvertQuery("how much in BTC", "eth", {
      lastBalance: {
        chain: "eth",
        address: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
        wei: "0x8a181cb74e9b",
      },
    });
    expect(intent?.method).toBe("__native_convert__");
    expect(intent?.params[3]).toBe("btc");
  });

  it("matches SOL crypto-to-crypto follow-up", () => {
    const intent = matchConvertQuery("how much in SOL", "eth", {
      lastBalance: {
        chain: "eth",
        address: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
        wei: "0x4ef972b0b91ff87a",
      },
    });
    expect(intent?.method).toBe("__native_convert__");
    expect(intent?.params[3]).toBe("sol");
    expect(intent?.params[4]).toBe("SOL");
  });

  it("matches convert to matic", () => {
    const intent = matchConvertQuery("convert to matic", "eth", {
      lastBalance: { chain: "eth", address: "0xabc", wei: "0x1" },
    });
    expect(intent?.params[3]).toBe("pol");
  });

  it("does not match send transactions", () => {
    expect(matchConvertQuery("send 0.01 eth to 0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045", "eth")).toBeNull();
  });

  it("does not match balance on polygon", () => {
    expect(matchConvertQuery("balance of 0xabc on polygon", "eth")).toBeNull();
  });

  it("returns null for convert follow-up without context", () => {
    expect(matchConvertQuery("how much in SOL", "eth")).toBeNull();
  });

  it("matches how much USDT for 1 ETH", () => {
    const intent = matchConvertQuery("how much USDT can i get for 1 ETH", "eth");
    expect(intent?.method).toBe("__native_convert__");
    expect(intent?.params[4]).toBe("USDT");
    expect(intent?.params[1]).toBe(`0x${BigInt(1e18).toString(16)}`);
  });

  it("matches 1 ETH in USDC", () => {
    const intent = matchConvertQuery("1 ETH in USDC", "eth");
    expect(intent?.method).toBe("__native_convert__");
    expect(intent?.params[4]).toBe("USDC");
  });
});

describe("isTokenQuoteQuery", () => {
  it("detects read-only token quotes", () => {
    expect(isTokenQuoteQuery("how much USDT can i get for 1 ETH")).toBe(true);
    expect(isTokenQuoteQuery("1 weth worth in usdt")).toBe(true);
  });

  it("excludes swap execution requests", () => {
    expect(isTokenQuoteQuery("swap 1 ETH to USDT")).toBe(false);
    expect(isTokenQuoteQuery("trade USDC for WETH")).toBe(false);
  });
});
