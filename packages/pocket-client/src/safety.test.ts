import { describe, expect, it } from "vitest";
import { preCheckRpc, postCheckResponse, assertCompareChainCount } from "./safety.js";

describe("rpc safety", () => {
  it("blocks dangerous signing methods", () => {
    const result = preCheckRpc("eth_sign", ["0xabc"]);
    expect(result.allowed).toBe(false);
  });

  it("requires address or topics for eth_getLogs", () => {
    const result = preCheckRpc("eth_getLogs", [{ fromBlock: "0x1", toBlock: "0x2" }]);
    expect(result.allowed).toBe(false);
  });

  it("rejects oversized eth_getLogs block range", () => {
    const result = preCheckRpc("eth_getLogs", [
      {
        fromBlock: "0x0",
        toBlock: "0x2711",
        address: "0x0000000000000000000000000000000000000000",
      },
    ]);
    expect(result.allowed).toBe(false);
  });

  it("allows bounded eth_getLogs", () => {
    const result = preCheckRpc("eth_getLogs", [
      {
        fromBlock: "0x0",
        toBlock: "0x10",
        address: "0x0000000000000000000000000000000000000000",
      },
    ]);
    expect(result.allowed).toBe(true);
  });

  it("truncates oversized responses", () => {
    const big = { data: "x".repeat(60_000) };
    const checked = postCheckResponse(big);
    expect(checked.truncated).toBe(true);
  });

  it("caps compare_balances chain count", () => {
    expect(() => assertCompareChainCount(6)).toThrow(/at most 5/);
  });
});
