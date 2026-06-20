import { describe, expect, it } from "vitest";
import {
  isAgentLoopEnabled,
  loadAgentMaxSteps,
  loadLlmConfig,
  validateLlmConfig,
} from "@pokt-mcp/shared";

describe("validateLlmConfig", () => {
  it("warns when FEATURE_NL_LLM is disabled", () => {
    const result = validateLlmConfig({ FEATURE_NL_LLM: "false" });
    expect(result.config).toBeNull();
    expect(result.warnings.some((w) => w.includes("FEATURE_NL_LLM is off"))).toBe(true);
  });

  it("warns when litellm has no model", () => {
    const result = validateLlmConfig({
      FEATURE_NL_LLM: "true",
      LLM_PROVIDER: "litellm",
      LITELLM_BASE_URL: "http://localhost:4000",
    });
    expect(result.config).toBeNull();
    expect(result.warnings.some((w) => w.includes("LLM_MODEL"))).toBe(true);
  });

  it("returns config when properly configured", () => {
    const result = validateLlmConfig({
      FEATURE_NL_LLM: "true",
      LLM_PROVIDER: "openai",
      OPENAI_API_KEY: "sk-test",
      LLM_MODEL: "gpt-4o-mini",
    });
    expect(result.config?.model).toBe("gpt-4o-mini");
    expect(result.warnings).toHaveLength(0);
  });
});

describe("isAgentLoopEnabled", () => {
  it("defaults to disabled", () => {
    expect(isAgentLoopEnabled({})).toBe(false);
  });

  it("respects explicit enable", () => {
    expect(isAgentLoopEnabled({ FEATURE_AGENT_LOOP: "true" })).toBe(true);
  });

  it("respects explicit disable", () => {
    expect(isAgentLoopEnabled({ FEATURE_AGENT_LOOP: "false" })).toBe(false);
  });
});

describe("loadAgentMaxSteps", () => {
  it("defaults to 8", () => {
    expect(loadAgentMaxSteps({})).toBe(8);
  });

  it("parses custom value", () => {
    expect(loadAgentMaxSteps({ AGENT_MAX_STEPS: "12" })).toBe(12);
  });
});

describe("loadLlmConfig", () => {
  it("returns null when FEATURE_NL_LLM is disabled", () => {
    expect(
      loadLlmConfig({
        FEATURE_NL_LLM: "false",
        LLM_PROVIDER: "litellm",
        LITELLM_BASE_URL: "http://localhost:4000",
      }),
    ).toBeNull();
  });

  it("returns null for litellm without explicit model", () => {
    expect(
      loadLlmConfig({
        FEATURE_NL_LLM: "true",
        LLM_PROVIDER: "litellm",
        LITELLM_BASE_URL: "http://localhost:4000",
        LITELLM_API_KEY: "test-key",
      }),
    ).toBeNull();
  });

  it("configures LiteLLM localhost proxy", () => {
    const config = loadLlmConfig({
      FEATURE_NL_LLM: "true",
      LLM_PROVIDER: "litellm",
      LITELLM_BASE_URL: "http://localhost:4000",
      LITELLM_API_KEY: "test-key",
      LLM_MODEL: "gpt-4o-mini",
    });

    expect(config).toEqual({
      provider: "litellm",
      apiKey: "test-key",
      baseUrl: "http://localhost:4000/v1",
      model: "gpt-4o-mini",
      enabled: true,
    });
  });

  it("configures OpenAI when provider is openai", () => {
    const config = loadLlmConfig({
      FEATURE_NL_LLM: "true",
      LLM_PROVIDER: "openai",
      OPENAI_API_KEY: "sk-test",
      LLM_MODEL: "gpt-4o",
    });

    expect(config).toEqual({
      provider: "openai",
      apiKey: "sk-test",
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-4o",
      enabled: true,
    });
  });
});
