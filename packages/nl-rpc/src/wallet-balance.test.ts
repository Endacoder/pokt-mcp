import { describe, expect, it, vi } from "vitest";
import {
  executeWalletBalances,
  formatWalletBalances,
  isWalletBalanceQuery,
  matchWalletBalanceQuery,
} from "./wallet-balance.js";

describe("isWalletBalanceQuery", () => {
  it("detects possessive wallet balance queries", () => {
    expect(isWalletBalanceQuery("what is my wallet balance")).toBe(true);
    expect(isWalletBalanceQuery("show my balance")).toBe(true);
    expect(isWalletBalanceQuery("show my balances across chains")).toBe(true);
    expect(isWalletBalanceQuery("bring up my portfolio")).toBe(true);
    expect(isWalletBalanceQuery("show my portfolio")).toBe(true);
    expect(isWalletBalanceQuery("what's in my wallet")).toBe(true);
    expect(isWalletBalanceQuery("balance of 0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045")).toBe(false);
  });

  it("does not treat feature queries as wallet balance", () => {
    expect(isWalletBalanceQuery("DeFi positions for my wallet")).toBe(false);
    expect(isWalletBalanceQuery("wallet health for my wallet")).toBe(false);
    expect(isWalletBalanceQuery("Aave health factor for my wallet")).toBe(false);
    expect(isWalletBalanceQuery("scan my wallet for scams")).toBe(false);
  });
});

describe("matchWalletBalanceQuery", () => {
  it("returns wallet balances intent when connected", () => {
    const intent = matchWalletBalanceQuery("what is my wallet balance", {
      connectedAddress: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
      defaultChain: "eth",
    });
    expect(intent?.method).toBe("__wallet_balances__");
    expect(intent?.params).toEqual(["eth", "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045"]);
  });

  it("returns multi-chain intent for across chains query", () => {
    const intent = matchWalletBalanceQuery("Show my balances across chains", {
      connectedAddress: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
      defaultChain: "eth",
    });
    expect(intent?.method).toBe("__wallet_balances_multi__");
    expect(intent?.params).toEqual(["0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045"]);
  });

  it("returns multi-chain intent for portfolio query", () => {
    const intent = matchWalletBalanceQuery("bring up my portfolio", {
      connectedAddress: "0xb6c95ca2241000facad83ef2b7ce4305bcae1f2f",
      defaultChain: "eth",
    });
    expect(intent?.method).toBe("__wallet_balances_multi__");
    expect(intent?.humanSummary).toContain("Portfolio");
  });

  it("returns single-chain portfolio when chain is specified", () => {
    const intent = matchWalletBalanceQuery("show my portfolio on base", {
      connectedAddress: "0xb6c95ca2241000facad83ef2b7ce4305bcae1f2f",
      defaultChain: "eth",
    });
    expect(intent?.method).toBe("__wallet_balances__");
    expect(intent?.params?.[0]).toBe("base");
  });

  it("throws when wallet not connected", () => {
    expect(() => matchWalletBalanceQuery("what is my wallet balance", { defaultChain: "eth" })).toThrow(
      "WALLET_NOT_CONNECTED",
    );
  });
});

describe("executeWalletBalances", () => {
  it("fetches native and stablecoin balances", async () => {
    const pocket = {
      rpc: vi.fn(async (_chain: string, method: string) => {
        if (method === "eth_getBalance") {
          return { result: "0xde0b6b3a7640000" };
        }
        if (method === "eth_call") {
          return { result: "0x5f5e100" };
        }
        throw new Error(`unexpected ${method}`);
      }),
    };

    const result = await executeWalletBalances(
      pocket as never,
      "eth",
      "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
    );

    expect(result.nativeBalance).toBe("1");
    expect(result.tokens.some((t) => t.symbol === "USDC")).toBe(true);
    expect(result.tokens.some((t) => t.symbol === "USDT")).toBe(true);
    expect(formatWalletBalances(result)).toContain("ETH: 1");
  });
});
