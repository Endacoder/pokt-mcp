import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_INTENT_MCP_REMOTE_URL,
  isMcpHttpEndpoint,
  loadIntentMcpConfig,
} from "./intent-mcp.js";

describe("loadIntentMcpConfig", () => {
  it("defaults to mcp-remote (Metalift) when only API key is set", () => {
    vi.stubEnv("INTENT_MCP_API_KEY", "test-key");
    vi.stubEnv("INTENT_MCP_API_URL", "");
    const config = loadIntentMcpConfig();
    expect(config).toMatchObject({
      transport: "mcp-remote",
      mcpUrl: DEFAULT_INTENT_MCP_REMOTE_URL,
      apiKey: "test-key",
    });
  });

  it("uses REST when API URL is a local intent-api base", () => {
    vi.stubEnv("INTENT_MCP_API_KEY", "test-key");
    vi.stubEnv("INTENT_MCP_API_URL", "http://127.0.0.1:3101");
    const config = loadIntentMcpConfig();
    expect(config).toMatchObject({
      transport: "rest",
      apiUrl: "http://127.0.0.1:3101",
    });
  });

  it("treats mcp.metalift.ai as MCP endpoint even in API_URL", () => {
    expect(isMcpHttpEndpoint("https://mcp.metalift.ai/mcp")).toBe(true);
    vi.stubEnv("INTENT_MCP_API_KEY", "test-key");
    vi.stubEnv("INTENT_MCP_API_URL", "https://mcp.metalift.ai/mcp");
    const config = loadIntentMcpConfig();
    expect(config?.transport).toBe("mcp-remote");
    expect(config?.mcpUrl).toBe("https://mcp.metalift.ai/mcp");
  });
});
