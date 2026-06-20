import { describe, expect, it } from "vitest";
import { buildAssistantInfoMessage, buildDataSourcesInfoMessage, matchMetaQuery } from "./meta.js";

describe("matchMetaQuery", () => {
  it("matches model identity questions", () => {
    for (const query of [
      "what model are you",
      "wha tmodel are you",
      "what mdoel are you using",
      "Which model do you use?",
      "what llm powers this",
      "who are you",
    ]) {
      const intent = matchMetaQuery(query);
      expect(intent?.method).toBe("__assistant_info__");
    }
  });

  it("does not match blockchain queries", () => {
    expect(matchMetaQuery("latest block on base")).toBeNull();
    expect(matchMetaQuery("balance of 0xabc")).toBeNull();
  });

  it("matches data source questions", () => {
    const intent = matchMetaQuery("are you using the chain rpc or coin gecko api");
    expect(intent?.method).toBe("__assistant_info__");
    expect(intent?.params[0]).toBe("data_sources");
  });
});

describe("buildDataSourcesInfoMessage", () => {
  it("mentions CoinGecko for prices and RPC for on-chain", () => {
    const message = buildDataSourcesInfoMessage();
    expect(message).toContain("CoinGecko");
    expect(message).toContain("Pocket Network RPC");
  });
});

describe("buildAssistantInfoMessage", () => {
  it("includes provider and model when LLM is enabled", () => {
    const message = buildAssistantInfoMessage({
      provider: "litellm",
      apiKey: "test",
      baseUrl: "http://localhost:4000/v1",
      model: "gpt-4o-mini",
      enabled: true,
    });
    expect(message).toContain("litellm");
    expect(message).toContain("gpt-4o-mini");
  });

  it("explains template-only mode when LLM is disabled", () => {
    const message = buildAssistantInfoMessage(null);
    expect(message).toContain("FEATURE_NL_LLM");
  });
});
