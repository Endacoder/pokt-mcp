import { describe, expect, it } from "vitest";
import { streamOpenAiChatCompletion } from "./llm-stream.js";
import type { LlmConfig } from "./llm-config.js";

const mockConfig: LlmConfig = {
  provider: "openai",
  apiKey: "sk-test",
  baseUrl: "https://api.test/v1",
  model: "test-model",
  enabled: true,
};

function sseBody(chunks: unknown[]): Response {
  const text = `${chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("")}data: [DONE]\n\n`;
  return new Response(text, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

describe("streamOpenAiChatCompletion", () => {
  it("yields reasoning and content deltas", async () => {
    globalThis.fetch = (async () =>
      sseBody([
        { choices: [{ delta: { reasoning_content: "Think" } }] },
        { choices: [{ delta: { reasoning_content: " step" } }] },
        { choices: [{ delta: { content: "Hello" } }] },
      ])) as typeof fetch;

    const events: string[] = [];
    const stream = streamOpenAiChatCompletion(mockConfig, { model: "test-model", messages: [] });
    let result;
    while (true) {
      const step = await stream.next();
      if (step.done) {
        result = step.value;
        break;
      }
      events.push(`${step.value.type}:${step.value.text}`);
    }

    expect(events).toEqual(["reasoning:Think", "reasoning: step", "content:Hello"]);
    expect(result?.reasoning).toBe("Think step");
    expect(result?.content).toBe("Hello");
  });
});
