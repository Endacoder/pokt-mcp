import { describe, expect, it } from "vitest";
import {
  buildInterpretationFacts,
  formatInterpretationFallback,
  needsResultInterpretation,
} from "./interpret.js";

describe("needsResultInterpretation", () => {
  it("returns true for qualitative gas queries", () => {
    expect(
      needsResultInterpretation("is gas low or high on eth", {
        action: "read",
        chain: "eth",
        method: "eth_gasPrice",
        params: [],
        humanSummary: "gas",
        riskLevel: "none",
      }),
    ).toBe(true);
  });

  it("returns false for plain gas price", () => {
    expect(
      needsResultInterpretation("gas price on eth", {
        action: "read",
        chain: "eth",
        method: "eth_gasPrice",
        params: [],
        humanSummary: "gas",
        riskLevel: "none",
      }),
    ).toBe(false);
  });
});

describe("formatInterpretationFallback", () => {
  it("produces contextual gas answer", () => {
    const intent = {
      action: "read" as const,
      chain: "eth",
      method: "eth_gasPrice",
      params: [],
      humanSummary: "gas",
      riskLevel: "none" as const,
    };
    const output = { result: "0x77359400" }; // 2 gwei
    const msg = formatInterpretationFallback("is gas low or high", intent, output);
    expect(msg).toContain("low");
    expect(msg).toContain("gwei");
  });
});

describe("buildInterpretationFacts", () => {
  it("includes assessment for eth_gasPrice", () => {
    const facts = buildInterpretationFacts(
      {
        action: "read",
        chain: "eth",
        method: "eth_gasPrice",
        params: [],
        humanSummary: "gas",
        riskLevel: "none",
      },
      { result: "0x4a817c800" }, // 20 gwei
    );
    expect(facts?.type).toBe("gas_price");
    expect((facts?.assessment as { level: string }).level).toBe("normal");
  });
});
