import { describe, expect, it } from "vitest";
import {
  assessGasPrice,
  formatGasAssessmentMessage,
  wantsGasAssessment,
} from "./gas-assessment.js";

describe("wantsGasAssessment", () => {
  it("matches low/high gas questions", () => {
    expect(wantsGasAssessment("is the gas price low or high right now")).toBe(true);
    expect(wantsGasAssessment("is gas expensive on eth")).toBe(true);
    expect(wantsGasAssessment("how cheap is gas on base")).toBe(true);
  });

  it("does not match plain gas price queries", () => {
    expect(wantsGasAssessment("gas price on eth")).toBe(false);
    expect(wantsGasAssessment("current gas on base")).toBe(false);
  });
});

describe("assessGasPrice", () => {
  it("classifies very low eth mainnet gas", () => {
    const a = assessGasPrice(0.13, "eth");
    expect(a.level).toBe("very_low");
    expect(a.levelLabel).toBe("very low");
  });

  it("classifies normal eth mainnet gas", () => {
    const a = assessGasPrice(15, "eth");
    expect(a.level).toBe("normal");
  });

  it("classifies normal L2 gas", () => {
    const a = assessGasPrice(0.13, "base");
    expect(a.level).toBe("normal");
  });
});

describe("formatGasAssessmentMessage", () => {
  it("includes level and gwei", () => {
    const msg = formatGasAssessmentMessage("eth", assessGasPrice(0.13, "eth"));
    expect(msg).toContain("very low");
    expect(msg).toContain("0.13 gwei");
    expect(msg).toContain("5–30 gwei");
  });
});
