import { describe, expect, it } from "vitest";
import { createNlRpcEngine } from "./index.js";

describe("heuristic fallback", () => {
  const engine = createNlRpcEngine({ llm: null });

  it("parses List all Pocket chains", async () => {
    const parsed = await engine.parse("List all Pocket chains");
    expect(parsed.intent.method).toBe("__list_chains__");
  });

  it("parses what chains are available", async () => {
    const parsed = await engine.parse("what chains are available on pocket");
    expect(parsed.intent.method).toBe("__list_chains__");
  });

  it("parses nonce with address", async () => {
    const parsed = await engine.parse(
      "nonce for 0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045 on eth",
    );
    expect(parsed.intent.method).toBe("eth_getTransactionCount");
  });

  it("parses how high is the block on ethereum", async () => {
    const parsed = await engine.parse("how high is the block on ethereum");
    expect(parsed.intent.method).toBe("eth_blockNumber");
    expect(parsed.intent.chain).toBe("eth");
  });

  it("uses last balance context for follow-up balance phrasing without address", async () => {
    const parsed = await engine.parse("how much does it hold", {
      lastBalance: {
        chain: "eth",
        address: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
        wei: "0x1",
      },
    });
    expect(parsed.intent.method).toBe("eth_getBalance");
  });

  it("parses contract bytecode queries", async () => {
    const parsed = await engine.parse(
      "Bytecode at 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48 on eth",
    );
    expect(parsed.intent.method).toBe("eth_getCode");
    expect(parsed.intent.params[0]).toBe("0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48");
  });

  it("parses gas assessment questions", async () => {
    const parsed = await engine.parse("is gas low or high on ethereum");
    expect(parsed.intent.method).toBe("eth_gasPrice");
    expect(parsed.intent.chain).toBe("eth");
  });

  it("does not parse most traded token as list chains", async () => {
    const parsed = await engine.parse(
      "in the last 24 hours what has been the most traded token on ETH chain",
    );
    expect(parsed.intent.method).not.toBe("__list_chains__");
    expect(parsed.intent.method).toBe("__market_analytics_unsupported__");
  });
});
