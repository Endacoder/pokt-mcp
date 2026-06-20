import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { createNlRpcEngine } from "@pokt-mcp/nl-rpc";
import type { LlmConfig } from "@pokt-mcp/shared";

const mockLlmConfig: LlmConfig = {
  provider: "openai",
  apiKey: "sk-test",
  baseUrl: "https://api.test/v1",
  model: "gpt-4o-mini",
  enabled: true,
};

describe("LLM intent chain validation", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.stubEnv("FEATURE_NL_LLM", "true");
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.unstubAllEnvs();
  });

  it("rejects unknown chain slugs from LLM", async () => {
    globalThis.fetch = vi.fn(async () =>
      Response.json({
        choices: [
          {
            message: {
              content: JSON.stringify({
                action: "read",
                chain: "not-a-real-chain",
                method: "eth_blockNumber",
                params: [],
                humanSummary: "Get block",
                riskLevel: "none",
              }),
            },
          },
        ],
      }),
    ) as typeof fetch;

    const nlRpc = createNlRpcEngine({ llm: mockLlmConfig });
    await expect(nlRpc.parse("something random", { defaultChain: "eth" })).rejects.toThrow(
      /unknown chain slug/,
    );
  });
});
