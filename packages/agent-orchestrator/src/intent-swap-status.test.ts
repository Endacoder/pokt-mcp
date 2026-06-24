import { describe, expect, it } from "vitest";
import {
  formatSwapStatusAnswer,
  isSwapStatusQuery,
} from "./intent-swap-status.js";
import { parseSwapExecutionQuery } from "./intent-swap.js";

describe("isSwapStatusQuery", () => {
  it("matches swap status follow-ups", () => {
    expect(isSwapStatusQuery("did that swap succeed?")).toBe(true);
    expect(isSwapStatusQuery("what is the swap status")).toBe(true);
    expect(isSwapStatusQuery("was my swap successful")).toBe(true);
    expect(isSwapStatusQuery("is it done", { lastSwapIntent: { intentId: "int_1" } })).toBe(true);
    expect(isSwapStatusQuery("still pending", { lastSwapIntent: { intentId: "int_1" } })).toBe(true);
  });

  it("does not match new swap execution requests", () => {
    expect(isSwapStatusQuery("swap 1 USDT for ETH")).toBe(false);
    expect(parseSwapExecutionQuery("swap 1 USDT for ETH")).not.toBeNull();
  });

  it("does not match unrelated queries", () => {
    expect(isSwapStatusQuery("latest block on eth")).toBe(false);
  });
});

describe("formatSwapStatusAnswer", () => {
  it("formats completed swap with tx hash", () => {
    const text = formatSwapStatusAnswer(
      {
        intentId: "int_1",
        tokenIn: "USDT",
        tokenOut: "ETH",
        amountIn: "1",
        chainName: "Ethereum Mainnet",
        txHash: "0xabc",
      },
      { status: "completed", txHash: "0xabc" },
    );
    expect(text).toContain("completed successfully");
    expect(text).toContain("1 USDT → ETH");
    expect(text).toContain("0xabc");
  });

  it("formats pending swap", () => {
    const text = formatSwapStatusAnswer(
      { intentId: "int_2" },
      { status: "pending" },
    );
    expect(text).toContain("still processing");
  });
});
