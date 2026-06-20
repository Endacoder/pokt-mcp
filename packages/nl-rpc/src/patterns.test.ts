import { describe, expect, it } from "vitest";
import { wantsListChains, inferChain, normalizeQuery, wantsLatestSlot, wantsSolanaBalance } from "./patterns.js";

describe("patterns", () => {
  it("matches list all pocket chains", () => {
    expect(wantsListChains("List all Pocket chains")).toBe(true);
    expect(wantsListChains("what chains are supported")).toBe(true);
    expect(wantsListChains("show me pocket networks")).toBe(true);
  });

  it("does not match unrelated queries", () => {
    expect(wantsListChains("latest block on base")).toBe(false);
    expect(wantsListChains("most traded token on eth chain")).toBe(false);
    expect(wantsListChains("gas price on ethereum chain")).toBe(false);
  });

  it("does not treat my balances across chains as list chains", () => {
    expect(wantsListChains("Show my balances across chains")).toBe(false);
  });

  it("infers chain from name", () => {
    expect(inferChain("latest block on Base")).toBe("base");
    expect(inferChain("gas on polygon")).toBe("poly");
  });

  it("normalizes whitespace", () => {
    expect(normalizeQuery("  List   all   chains  ")).toBe("list all chains");
  });
});

  it("matches solana slot queries", () => {
    expect(wantsLatestSlot("latest slot on solana")).toBe(true);
    expect(wantsLatestSlot("latest block on base")).toBe(false);
  });

  it("matches solana balance queries", () => {
    const addr = "11111111111111111111111111111112";
    expect(wantsSolanaBalance(`SOL balance of ${addr} on solana`)).toBe(true);
  });
