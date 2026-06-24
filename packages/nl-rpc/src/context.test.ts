import { describe, expect, it } from "vitest";
import { expandFollowUpQuery, isVagueFollowUp } from "./context.js";

describe("isVagueFollowUp", () => {
  it("detects how about for the week", () => {
    expect(isVagueFollowUp("how about for the week")).toBe(true);
  });

  it("detects short time-only follow-ups", () => {
    expect(isVagueFollowUp("in a week")).toBe(true);
    expect(isVagueFollowUp("in 1 week")).toBe(true);
    expect(isVagueFollowUp("last week")).toBe(true);
    expect(isVagueFollowUp("in 24 hours")).toBe(true);
  });

  it("does not flag full standalone queries", () => {
    expect(isVagueFollowUp("gas price on ethereum")).toBe(false);
  });
});

describe("expandFollowUpQuery", () => {
  it("prepends prior user message for vague follow-ups", () => {
    const expanded = expandFollowUpQuery("how about in a week", [
      { role: "user", content: "how has btc been doing" },
      { role: "assistant", content: "BTC 24h change: +1.25%" },
    ]);
    expect(expanded).toContain("how has btc been doing");
    expect(expanded).toContain("how about in a week");
  });

  it("returns original query when history is empty", () => {
    expect(expandFollowUpQuery("how about in a week", [])).toBe("how about in a week");
  });
});
