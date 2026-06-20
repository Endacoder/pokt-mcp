import { describe, expect, it } from "vitest";
import { needsDynamicRouting } from "./routing.js";

describe("needsDynamicRouting", () => {
  it("returns false for template matches", () => {
    expect(needsDynamicRouting("latest block on base")).toBe(false);
    expect(needsDynamicRouting("gas price on eth")).toBe(false);
    expect(needsDynamicRouting("whats the last 5 transaction on my account with eth")).toBe(false);
    expect(
      needsDynamicRouting(
        "has 0x2b085d624f1663bf8661d5bc20a8d9883714405a ever received anything from me",
      ),
    ).toBe(false);
  });

  it("returns false for bytecode and transfer event fast paths", () => {
    expect(
      needsDynamicRouting(
        "Bytecode at 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48 on eth",
      ),
    ).toBe(false);
    expect(
      needsDynamicRouting(
        "Recent USDC Transfer events for 0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045 on eth",
      ),
    ).toBe(false);
  });

  it("returns true for unmatched queries", () => {
    expect(needsDynamicRouting("what is the bytecode at 0xabc on base")).toBe(true);
    expect(needsDynamicRouting("random blockchain question xyz")).toBe(true);
  });
});
