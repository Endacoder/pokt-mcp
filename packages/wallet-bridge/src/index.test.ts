import { describe, expect, it } from "vitest";
import { parseAllowedChains } from "@pokt-mcp/shared";

describe("wallet-bridge policy inputs", () => {
  it("parses allowed chains from env default", () => {
    const chains = parseAllowedChains();
    expect(chains.length).toBeGreaterThan(0);
    expect(chains).toContain("eth");
  });
});
