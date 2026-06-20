import { describe, expect, it } from "vitest";
import {
  isComplexQuery,
  isExecutionFailedError,
  isParseFailedError,
  isSwapQuery,
  shouldUseAgentFirst,
} from "./complexity.js";

describe("isComplexQuery extended signals", () => {
  it("detects contract and lookup queries", () => {
    expect(isComplexQuery("bytecode at 0xabc")).toBe(true);
    expect(isComplexQuery("show me validators on eth")).toBe(true);
    expect(isComplexQuery("find nft holders")).toBe(true);
  });
});

describe("isExecutionFailedError", () => {
  it("detects RPC and policy errors", () => {
    expect(isExecutionFailedError(new Error("RPC_ERROR -32000: revert"))).toBe(true);
    expect(isExecutionFailedError(new Error("POLICY_DENIED: method blocked"))).toBe(true);
    expect(isExecutionFailedError(new Error("CHAIN_NOT_FOUND: foo"))).toBe(true);
  });

  it("rejects unrelated errors", () => {
    expect(isExecutionFailedError(new Error("network timeout"))).toBe(false);
  });
});

describe("shouldUseAgentFirst", () => {
  it("does not route bytecode or transfer event queries to agent", () => {
    expect(
      shouldUseAgentFirst(
        "Bytecode at 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48 on eth",
        false,
      ),
    ).toBe(false);
    expect(
      shouldUseAgentFirst(
        "Recent USDC Transfer events for 0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045 on eth",
        false,
      ),
    ).toBe(false);
  });

  it("combines complex and dynamic routing signals", () => {
    expect(shouldUseAgentFirst("latest block", false)).toBe(false);
    expect(shouldUseAgentFirst("random xyz query", true)).toBe(true);
    expect(shouldUseAgentFirst("recent USDC transfers", false)).toBe(true);
  });
});

describe("isSwapQuery", () => {
  it("detects swap and trade requests", () => {
    expect(isSwapQuery("swap 50 USDC to ETH on Base")).toBe(true);
    expect(isSwapQuery("trade USDC for WETH")).toBe(true);
    expect(isSwapQuery("latest block on base")).toBe(false);
  });

  it("does not treat read-only price quotes as swaps", () => {
    expect(isSwapQuery("how much USDT can i get for 1 ETH")).toBe(false);
    expect(shouldUseAgentFirst("how much USDT can i get for 1 ETH", false)).toBe(false);
  });

  it("does not treat swap status follow-ups as new swap requests", () => {
    expect(isSwapQuery("did that swap succeed?")).toBe(false);
  });

  it("does not treat send status follow-ups as swaps", () => {
    expect(isSwapQuery("did that send succeed?")).toBe(false);
  });

  it("does not route my wallet balance to agent", () => {
    expect(shouldUseAgentFirst("what is my wallet balance", false)).toBe(false);
  });

  it("does not route spot price queries to agent", () => {
    expect(shouldUseAgentFirst("what is btc price right now", false)).toBe(false);
  });

  it("does not route data source meta questions to agent", () => {
    expect(shouldUseAgentFirst("are you using chain rpc or coingecko", false)).toBe(false);
  });
});
