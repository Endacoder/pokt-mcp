import { describe, expect, it } from "vitest";
import { getChatSession, setChatSession } from "@pokt-mcp/agent-orchestrator";
import { parseWalletAddress, resolveSwapWalletAddress } from "./swap-wallet.js";

const WALLET = "0xb6c95ca2241000facad83ef2b7ce4305bcae1f2f";
const SESSION = "00000000-0000-4000-8000-000000000002";

describe("parseWalletAddress", () => {
  it("accepts valid checksummed addresses", () => {
    expect(parseWalletAddress(WALLET)).toBe(WALLET);
  });

  it("rejects objects and metadata blobs", () => {
    expect(parseWalletAddress({ tokenIn: "USDC" })).toBeUndefined();
    expect(parseWalletAddress("")).toBeUndefined();
  });
});

describe("resolveSwapWalletAddress", () => {
  it("prefers body walletAddress", () => {
    const sessions = new Map<string, { address?: string }>();
    sessions.set(SESSION, { address: "0x0000000000000000000000000000000000000001" });
    expect(resolveSwapWalletAddress(SESSION, WALLET, sessions)).toBe(WALLET);
  });

  it("falls back to wallet session", () => {
    const sessions = new Map<string, { address?: string }>();
    sessions.set(SESSION, { address: WALLET });
    expect(resolveSwapWalletAddress(SESSION, undefined, sessions)).toBe(WALLET);
  });

  it("falls back to chat session connectedAddress", () => {
    const sessions = new Map<string, { address?: string }>();
    setChatSession(SESSION, { connectedAddress: WALLET, defaultChain: "eth" });
    expect(resolveSwapWalletAddress(SESSION, { tokenIn: "USDC" }, sessions)).toBe(WALLET);
  });
});
