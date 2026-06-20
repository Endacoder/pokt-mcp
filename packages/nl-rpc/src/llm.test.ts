import { describe, expect, it } from "vitest";
import { buildLlmSystemPrompt, resetLlmPromptCache } from "./llm.js";

describe("buildLlmSystemPrompt", () => {
  it("includes chain slugs and RPC methods", () => {
    resetLlmPromptCache();
    const prompt = buildLlmSystemPrompt();
    expect(prompt).toContain("eth_getBalance");
    expect(prompt).toContain("eth_call");
    expect(prompt).toContain("getBalance");
    expect(prompt).toMatch(/\beth\b/);
    expect(prompt).toContain("__spot_price__");
  });
});
