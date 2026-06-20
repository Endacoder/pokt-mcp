import { describe, expect, it } from "vitest";
import { isInternalApiKeyValid } from "./internal-auth.js";

describe("isInternalApiKeyValid", () => {
  it("allows any request when no key is configured", () => {
    expect(isInternalApiKeyValid(undefined, undefined)).toBe(true);
    expect(isInternalApiKeyValid("wrong", undefined)).toBe(true);
  });

  it("requires a matching key when configured", () => {
    expect(isInternalApiKeyValid("abc", "abc")).toBe(true);
    expect(isInternalApiKeyValid("wrong", "abc")).toBe(false);
    expect(isInternalApiKeyValid(undefined, "abc")).toBe(false);
  });
});
