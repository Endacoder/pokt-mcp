import { describe, expect, it } from "vitest";
import { parseJsonFromModelText } from "./parse-json.js";

describe("parseJsonFromModelText", () => {
  it("parses fenced JSON", () => {
    const value = parseJsonFromModelText('```json\n{"chain":"eth"}\n```');
    expect(value).toEqual({ chain: "eth" });
  });

  it("parses plain JSON", () => {
    expect(parseJsonFromModelText('{"a":1}')).toEqual({ a: 1 });
  });
});
