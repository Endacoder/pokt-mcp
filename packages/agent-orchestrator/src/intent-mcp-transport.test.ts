import { describe, expect, it } from "vitest";
import {
  isRetryableIntentMcpTransportError,
  summarizeIntentMcpTransportError,
  withIntentMcpTransportRetry,
} from "./intent-mcp-transport.js";

describe("isRetryableIntentMcpTransportError", () => {
  it("detects Cloudflare 502 bad gateway", () => {
    expect(
      isRetryableIntentMcpTransportError(
        new Error('Streamable HTTP error: Error POSTing to endpoint: {"status":502,"error_name":"origin_bad_gateway"}'),
      ),
    ).toBe(true);
  });

  it("ignores no-quotes business errors", () => {
    expect(isRetryableIntentMcpTransportError(new Error("No quotes available for this swap."))).toBe(
      false,
    );
  });
});

describe("summarizeIntentMcpTransportError", () => {
  it("shortens Cloudflare 502 JSON blobs", () => {
    const summary = summarizeIntentMcpTransportError(
      'Streamable HTTP error: Error POSTing to endpoint: {"status":502,"title":"Error 502: Bad gateway","cloudflare_error":true}',
    );
    expect(summary).toMatch(/502 Bad Gateway/i);
    expect(summary.length).toBeLessThan(200);
  });
});

describe("withIntentMcpTransportRetry", () => {
  it("retries retryable errors then succeeds", async () => {
    let calls = 0;
    const result = await withIntentMcpTransportRetry(
      async () => {
        calls++;
        if (calls < 2) throw new Error("HTTP 502 Bad Gateway");
        return "ok";
      },
      { maxAttempts: 3, delaysMs: [0, 0, 0] },
    );
    expect(result).toBe("ok");
    expect(calls).toBe(2);
  });
});
