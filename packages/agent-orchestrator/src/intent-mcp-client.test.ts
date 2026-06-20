import { describe, expect, it, vi, beforeEach } from "vitest";

const connect = vi.fn().mockResolvedValue(undefined);
const callTool = vi.fn();
const clientClose = vi.fn().mockResolvedValue(undefined);
const terminateSession = vi.fn().mockResolvedValue(undefined);
const transportOpts: Array<Record<string, unknown>> = [];

vi.mock("@modelcontextprotocol/sdk/client/index.js", () => ({
  Client: vi.fn(function MockClient() {
    return {
      connect,
      callTool,
      close: clientClose,
    };
  }),
}));

vi.mock("@modelcontextprotocol/sdk/client/streamableHttp.js", () => ({
  StreamableHTTPClientTransport: vi.fn(function MockTransport(_url: URL, opts?: Record<string, unknown>) {
    transportOpts.push(opts ?? {});
    return {
      terminateSession,
      sessionId: "server-assigned-session",
    };
  }),
}));

import { createIntentMcpSwapClient } from "./intent-mcp-client.js";

describe("RemoteMcpIntentSwapClient", () => {
  beforeEach(() => {
    connect.mockClear();
    callTool.mockReset();
    clientClose.mockClear();
    terminateSession.mockClear();
    transportOpts.length = 0;
    callTool.mockResolvedValue({
      content: [{ type: "text", text: JSON.stringify({ tokens: [{ address: "0x1", symbol: "USDT", decimals: 6 }] }) }],
    });
  });

  it("reuses one MCP session for multiple tool calls", async () => {
    const client = createIntentMcpSwapClient({
      enabled: true,
      apiKey: "test-key",
      transport: "mcp-remote",
      mcpUrl: "https://mcp.metalift.ai/mcp",
      apiUrl: "http://127.0.0.1:3101",
    });

    await client.searchToken(1, "USDT");
    callTool.mockResolvedValueOnce({
      content: [{ type: "text", text: JSON.stringify({ tokens: [{ address: "0x2", symbol: "WETH", decimals: 18 }] }) }],
    });
    await client.searchToken(1, "WETH");
    await client.close();

    expect(connect).toHaveBeenCalledTimes(1);
    expect(callTool).toHaveBeenCalledTimes(2);
    expect(terminateSession).toHaveBeenCalledTimes(1);
    expect(clientClose).toHaveBeenCalledTimes(1);
    expect(transportOpts[0]?.sessionId).toBeUndefined();
  });

  it("surfaces MCP tool errors from plain text responses", async () => {
    callTool.mockResolvedValueOnce({
      isError: true,
      content: [{ type: "text", text: "Quote q_abc has expired. Request a new quote." }],
    });

    const client = createIntentMcpSwapClient({
      enabled: true,
      apiKey: "test-key",
      transport: "mcp-remote",
      mcpUrl: "https://mcp.metalift.ai/mcp",
      apiUrl: "http://127.0.0.1:3101",
    });

    await expect(
      client.prepareIntent("q_abc", "0x1111111111111111111111111111111111111111"),
    ).rejects.toThrow(/expired/i);
  });

  it("retries once after session not found", async () => {
    callTool
      .mockRejectedValueOnce(new Error('Session not found'))
      .mockResolvedValueOnce({
        content: [{ type: "text", text: JSON.stringify({ tokens: [{ address: "0x1", symbol: "USDT", decimals: 6 }] }) }],
      });

    const client = createIntentMcpSwapClient({
      enabled: true,
      apiKey: "test-key",
      transport: "mcp-remote",
      mcpUrl: "https://mcp.metalift.ai/mcp",
      apiUrl: "http://127.0.0.1:3101",
    });

    await client.searchToken(1, "USDT");
    await client.close();

    expect(connect).toHaveBeenCalledTimes(2);
    expect(callTool).toHaveBeenCalledTimes(2);
  });
});
