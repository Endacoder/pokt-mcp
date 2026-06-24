import { describe, expect, it } from "vitest";
import {
  prepareSanitizedQueryInput,
  sanitizeChatHistory,
  sanitizeIntentForMcp,
  sanitizeQueryText,
  sanitizeSessionContextForLlm,
} from "./sanitize-context.js";

describe("sanitizeQueryText", () => {
  it("redacts labeled private keys", () => {
    const key = "0x" + "a".repeat(64);
    expect(sanitizeQueryText(`my private key: ${key}`)).toBe("my [REDACTED_KEY]");
  });

  it("preserves transaction hashes", () => {
    const tx = "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef12";
    expect(sanitizeQueryText(`transaction ${tx}`)).toBe(`transaction ${tx}`);
  });

  it("trims whitespace", () => {
    expect(sanitizeQueryText("  hello  ")).toBe("hello");
  });
});

describe("sanitizeChatHistory", () => {
  it("caps message count", () => {
    const history = Array.from({ length: 25 }, (_, i) => ({
      role: "user" as const,
      content: `msg ${i}`,
    }));
    const result = sanitizeChatHistory(history, 20);
    expect(result).toHaveLength(20);
  });
});

describe("sanitizeSessionContextForLlm", () => {
  it("passes through safe follow-up fields", () => {
    const ctx = sanitizeSessionContextForLlm({
      defaultChain: "eth",
      connectedAddress: "0xabc",
      lastMarketQuery: { symbol: "ETH", coingeckoId: "ethereum", kind: "spotPrice" },
    });
    expect(ctx?.defaultChain).toBe("eth");
    expect(ctx?.lastMarketQuery?.symbol).toBe("ETH");
  });
});

describe("sanitizeIntentForMcp", () => {
  it("normalizes chain slug", () => {
    const intent = sanitizeIntentForMcp({
      action: "read",
      chain: " ETH ",
      method: "eth_getBalance",
      params: ["0xabc"],
      humanSummary: "balance",
      riskLevel: "none",
    });
    expect(intent.chain).toBe("eth");
  });
});

describe("prepareSanitizedQueryInput", () => {
  it("returns sanitized query, history, and session", () => {
    const key = "0x" + "c".repeat(64);
    const result = prepareSanitizedQueryInput({
      query: `private key: ${key}`,
      history: [{ role: "user", content: "hi" }],
      sessionContext: { defaultChain: "base" },
    });
    expect(result.query).toContain("[REDACTED_KEY]");
    expect(result.history).toHaveLength(1);
    expect(result.sessionContext?.defaultChain).toBe("base");
  });
});
