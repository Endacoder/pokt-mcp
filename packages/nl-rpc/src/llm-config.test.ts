import { describe, expect, it } from "vitest";
import { loadLlmConfig } from "@pokt-mcp/shared";

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
