import { describe, expect, it } from "vitest";
import { formatTimeOffsetLabel, estimateBlockSearchWindow, matchTemporalQuery, parseTimeOffsetSeconds } from "./temporal.js";

describe("parseTimeOffsetSeconds", () => {
  it("parses hour offsets", () => {
    expect(parseTimeOffsetSeconds("what was it 1 hour ago")).toBe(3600);
    expect(parseTimeOffsetSeconds("gas price 2 hours ago")).toBe(7200);
  });

  it("parses shorthand units", () => {
    expect(parseTimeOffsetSeconds("30m ago")).toBe(1800);
    expect(parseTimeOffsetSeconds("5d ago")).toBe(432000);
  });

  it("parses relative phrases", () => {
    expect(parseTimeOffsetSeconds("yesterday")).toBe(86400);
    expect(parseTimeOffsetSeconds("an hour ago")).toBe(3600);
  });
});

describe("formatTimeOffsetLabel", () => {
  it("formats common offsets", () => {
    expect(formatTimeOffsetLabel(3600)).toBe("1 hour ago");
    expect(formatTimeOffsetLabel(7200)).toBe("2 hours ago");
  });
});

describe("estimateBlockSearchWindow", () => {
  it("narrows search to a small window for recent offsets", () => {
    const latest = 25_000_000n;
    const latestTs = 1_800_000_000;
    const targetTs = latestTs - 3600;
    const { lo, hi } = estimateBlockSearchWindow(latest, latestTs, targetTs, 12);
    expect(hi - lo).toBeLessThan(500n);
    expect(lo).toBeGreaterThan(24_999_000n);
  });
});

describe("matchTemporalQuery", () => {
  it("matches gas follow-up from session context", () => {
    const intent = matchTemporalQuery("what was it 1 hour ago", "eth", {
      lastQuery: { chain: "eth", method: "eth_gasPrice", subject: "gas", params: [] },
    });
    expect(intent?.method).toBe("__query_at_time__");
    expect(intent?.params).toEqual(["eth", "gas", 3600]);
  });

  it("matches standalone gas price at time", () => {
    const intent = matchTemporalQuery("gas price on eth 1 hour ago", "eth");
    expect(intent?.method).toBe("__query_at_time__");
    expect(intent?.params[1]).toBe("gas");
  });

  it("matches balance follow-up with last query address", () => {
    const intent = matchTemporalQuery("what was it 30 minutes ago", "eth", {
      lastQuery: {
        chain: "eth",
        method: "eth_getBalance",
        subject: "balance",
        params: ["0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045"],
      },
    });
    expect(intent?.params).toEqual([
      "eth",
      "balance",
      1800,
      "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
    ]);
  });

  it("returns null without time offset", () => {
    expect(matchTemporalQuery("gas price on eth", "eth")).toBeNull();
  });

  it("returns null for follow-up without context", () => {
    expect(matchTemporalQuery("what was it 1 hour ago", "eth")).toBeNull();
  });
});
