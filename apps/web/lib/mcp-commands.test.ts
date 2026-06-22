import { describe, expect, it } from "vitest";
import {
  commandHandle,
  filterMcpCommands,
  hasSendableContent,
  isHandleOnly,
  MCP_COMMANDS,
  MCP_EXAMPLE_ADDRESS,
  resolveChatMessage,
  resolveCommandExample,
  stripCommandHandle,
} from "./mcp-commands";

describe("mcp-commands", () => {
  it("includes all pocket tools", () => {
    expect(MCP_COMMANDS.length).toBeGreaterThanOrEqual(30);
    expect(MCP_COMMANDS.some((c) => c.tool === "pocket_query")).toBe(true);
    expect(MCP_COMMANDS.some((c) => c.tool === "pocket_wallet_health")).toBe(true);
  });

  it("filters by tool name and label", () => {
    const results = filterMcpCommands("governance");
    expect(results.some((c) => c.tool === "pocket_governance_query")).toBe(true);
  });

  it("hides wallet-only commands when disconnected", () => {
    const results = filterMcpCommands("", { walletConnected: false });
    expect(results.some((c) => c.tool === "wallet_send_transaction")).toBe(false);
  });

  it("builds command handles with trailing space", () => {
    expect(commandHandle("pocket_query")).toBe("@pocket_query ");
  });

  it("resolves handle-only input to command example", () => {
    expect(resolveChatMessage("@pocket_query")).toBe("Latest block on Base");
  });

  it("uses wallet example when wallet is connected", () => {
    const wallet = "0xabc1234567890123456789012345678901234567890";
    expect(
      resolveChatMessage("@pocket_query", { context: { walletAddress: wallet, chain: "base" } }),
    ).toBe("What is my wallet balance?");
    expect(
      resolveChatMessage("@pocket_wallet_health", { context: { walletAddress: wallet } }),
    ).toBe("Wallet health check for my wallet");
    expect(
      resolveCommandExample(
        MCP_COMMANDS.find((c) => c.tool === "pocket_get_balance")!,
        { walletAddress: wallet, chain: "base" },
      ),
    ).toBe("What is my wallet balance?");
    expect(
      resolveCommandExample(
        MCP_COMMANDS.find((c) => c.tool === "pocket_get_nonce")!,
        { walletAddress: wallet, chain: "base" },
      ),
    ).toBe(`Nonce for ${wallet} on base`);
    expect(
      resolveCommandExample(
        MCP_COMMANDS.find((c) => c.tool === "pocket_get_logs")!,
        { walletAddress: wallet },
      ).includes(wallet),
    ).toBe(true);
    expect(
      resolveCommandExample(
        MCP_COMMANDS.find((c) => c.tool === "pocket_get_logs")!,
        { walletAddress: wallet },
      ).includes(MCP_EXAMPLE_ADDRESS),
    ).toBe(false);
  });

  it("keeps user text after handle", () => {
    expect(resolveChatMessage("@pocket_query balance on eth")).toBe("balance on eth");
  });

  it("detects sendable handle-only and body content", () => {
    expect(hasSendableContent("@pocket_query")).toBe(true);
    expect(hasSendableContent("@pocket_query ")).toBe(true);
    expect(hasSendableContent("@pocket_query check eth")).toBe(true);
    expect(hasSendableContent("")).toBe(false);
    expect(isHandleOnly("@pocket_query")).toBe(true);
    expect(stripCommandHandle("@pocket_query foo bar")).toBe("foo bar");
  });
});
