import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { createPocketClient } from "@pokt-mcp/pocket-client";
import type { LlmConfig } from "@pokt-mcp/shared";
import { runAgentLoop } from "./agent-loop.js";

const mockLlmConfig: LlmConfig = {
  provider: "openai",
  apiKey: "sk-test",
  baseUrl: "https://api.test/v1",
  model: "gpt-4o-mini",
  enabled: true,
};

describe("runAgentLoop", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.stubEnv("FEATURE_NL_LLM", "true");
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    vi.stubEnv("LLM_MODEL", "gpt-4o-mini");
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.unstubAllEnvs();
  });

  it("yields tool events and final answer from mocked LLM", async () => {
    let callCount = 0;
    globalThis.fetch = vi.fn(async () => {
      callCount++;
      if (callCount === 1) {
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: null,
                  tool_calls: [
                    {
                      id: "call_1",
                      type: "function",
                      function: {
                        name: "list_chains",
                        arguments: "{}",
                      },
                    },
                  ],
                },
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: "Found 6 chains available." } }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as typeof fetch;

    const events: Array<{ type: string; data: unknown }> = [];
    for await (const event of runAgentLoop({
      query: "what chains are available",
      sessionContext: { defaultChain: "eth" },
      llmConfig: mockLlmConfig,
      pocket: createPocketClient(),
      maxSteps: 4,
    })) {
      events.push(event);
    }

    const toolEvents = events.filter((e) => e.type === "tool");
    expect(toolEvents.length).toBeGreaterThanOrEqual(1);
    expect(toolEvents[0]?.data).toMatchObject({ tool: "list_chains" });

    const resultEvent = events.find((e) => e.type === "result");
    expect(resultEvent?.data).toMatchObject({ answer: "Found 6 chains available." });
    expect(events.some((e) => e.type === "done")).toBe(true);
  });
});
