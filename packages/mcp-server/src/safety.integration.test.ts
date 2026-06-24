import { describe, expect, it } from "vitest";
import { preCheckRpc } from "@pokt-mcp/pocket-client";

describe("MCP RPC safety integration", () => {
  it("rejects unbounded eth_getLogs at client level", () => {
    const result = preCheckRpc("eth_getLogs", [{ fromBlock: "0x0", toBlock: "0x989680" }]);
    expect(result.allowed).toBe(false);
  });
});
