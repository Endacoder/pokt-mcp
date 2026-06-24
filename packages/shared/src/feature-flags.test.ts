import { describe, expect, it } from "vitest";
import { isThinkingEnabled } from "./feature-flags.js";

describe("isThinkingEnabled", () => {
  it("defaults to disabled", () => {
    expect(isThinkingEnabled({})).toBe(false);
  });

  it("respects explicit enable via FEATURE_THINKING", () => {
    expect(isThinkingEnabled({ FEATURE_THINKING: "true" })).toBe(true);
  });

  it("respects explicit enable via NEXT_PUBLIC_FEATURE_THINKING", () => {
    expect(isThinkingEnabled({ NEXT_PUBLIC_FEATURE_THINKING: "1" })).toBe(true);
  });

  it("respects explicit disable", () => {
    expect(isThinkingEnabled({ FEATURE_THINKING: "false" })).toBe(false);
  });
});
