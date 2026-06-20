import { describe, expect, it } from "vitest";
import { MCP_SERVER_INSTRUCTIONS, MCP_TOOL_GUIDE } from "./instructions.js";

describe("MCP_SERVER_INSTRUCTIONS", () => {
  it("exports tool guide as alias of server instructions", () => {
    expect(MCP_TOOL_GUIDE).toBe(MCP_SERVER_INSTRUCTIONS);
  });

  it("contains core tool and response anchors", () => {
    expect(MCP_SERVER_INSTRUCTIONS).toContain("pocket_query");
    expect(MCP_SERVER_INSTRUCTIONS).toContain("wallet_get_status");
    expect(MCP_SERVER_INSTRUCTIONS).toContain("answer / naturalLanguageSummary");
    expect(MCP_SERVER_INSTRUCTIONS).toContain("naturalLanguageSummary");
  });

  it("documents tx history and explorer API requirements", () => {
    expect(MCP_SERVER_INSTRUCTIONS).toContain("EXPLORER_API_KEY");
    expect(MCP_SERVER_INSTRUCTIONS).toContain("ever received anything from me");
    expect(MCP_SERVER_INSTRUCTIONS).toContain("eth_getTransactionByAddress");
  });

  it("documents swap scope and anti-patterns", () => {
    expect(MCP_SERVER_INSTRUCTIONS).toContain("does NOT execute swaps");
    expect(MCP_SERVER_INSTRUCTIONS).toContain("third-party swap MCP");
    expect(MCP_SERVER_INSTRUCTIONS).toContain("NEVER describe hypothetical tool calls");
  });

  it("covers major scenario categories", () => {
    expect(MCP_SERVER_INSTRUCTIONS).toContain("CoinGecko");
    expect(MCP_SERVER_INSTRUCTIONS).toContain("Show my balances across chains");
    expect(MCP_SERVER_INSTRUCTIONS).toContain("analyze-wallet");
    expect(MCP_SERVER_INSTRUCTIONS).toContain("NL_PARSE_FAILED");
  });
});
