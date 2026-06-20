import { describe, expect, it } from "vitest";
import { isValidSessionId, requireSessionId } from "./session.js";

describe("requireSessionId", () => {
  it("accepts a valid UUID", () => {
    const id = "a1b2c3d4-e5f6-4789-a012-3456789abcde";
    expect(requireSessionId(id)).toBe(id);
    expect(isValidSessionId(id)).toBe(true);
  });

  it("rejects missing session id", () => {
    expect(() => requireSessionId(undefined)).toThrow("SESSION_REQUIRED");
    expect(() => requireSessionId("")).toThrow("SESSION_REQUIRED");
  });

  it("rejects reserved default id", () => {
    expect(() => requireSessionId("default")).toThrow("SESSION_INVALID");
  });

  it("rejects non-uuid values", () => {
    expect(() => requireSessionId("not-a-uuid")).toThrow("SESSION_INVALID");
  });
});
