import { describe, expect, it } from "vitest";
import { parseMarketTimePeriod, resolveMarketPeriod } from "./time-periods.js";
import { isVagueFollowUp, isTemporalFollowUp, isVagueStatusFollowUp } from "./follow-up-phrases.js";
import { parseTimeOffsetSeconds } from "./time-offsets.js";

describe("parseMarketTimePeriod", () => {
  it("parses week variants", () => {
    expect(parseMarketTimePeriod("how about for the week")).toBe("7d");
    expect(parseMarketTimePeriod("past 7 days")).toBe("7d");
    expect(parseMarketTimePeriod("in 1 week")).toBe("7d");
    expect(parseMarketTimePeriod("in 2 weeks")).toBe("14d");
    expect(parseMarketTimePeriod("last two weeks")).toBe("14d");
  });

  it("parses month and year", () => {
    expect(parseMarketTimePeriod("last month")).toBe("30d");
    expect(parseMarketTimePeriod("ytd")).toBe("1y");
    expect(parseMarketTimePeriod("since yesterday")).toBe("24h");
  });

  it("resolves explicit numeric durations", () => {
    expect(resolveMarketPeriod("in 7 days")).toBe("7d");
    expect(resolveMarketPeriod("in 24 hours")).toBe("24h");
    expect(resolveMarketPeriod("in 3 days")).toBe("unmapped");
    expect(resolveMarketPeriod("in 12 hours")).toBe("unmapped");
  });
});

describe("parseTimeOffsetSeconds", () => {
  it("parses ago offsets", () => {
    expect(parseTimeOffsetSeconds("2 hours ago")).toBe(7200);
    expect(parseTimeOffsetSeconds("a week ago")).toBe(604800);
  });
});

describe("follow-up phrases", () => {
  it("detects vague follow-ups", () => {
    expect(isVagueFollowUp("how about for the week")).toBe(true);
    expect(isVagueFollowUp("same for eth")).toBe(true);
    expect(isVagueFollowUp("in 1 week")).toBe(true);
    expect(isVagueFollowUp("in 24 hours")).toBe(true);
  });

  it("detects temporal follow-ups", () => {
    expect(isTemporalFollowUp("what was it 1 hour ago")).toBe(true);
    expect(isTemporalFollowUp("back then")).toBe(true);
  });

  it("detects vague status follow-ups", () => {
    expect(isVagueStatusFollowUp("did it go through")).toBe(true);
    expect(isVagueStatusFollowUp("any update")).toBe(true);
  });
});
