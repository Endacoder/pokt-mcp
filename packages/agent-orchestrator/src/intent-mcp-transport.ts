/** Cloudflare / origin transport failures that are safe to retry with backoff. */
export function isRetryableIntentMcpTransportError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return (
    /502|503|504/i.test(message) ||
    /bad gateway|service unavailable|gateway timeout/i.test(message) ||
    /origin_bad_gateway|origin.*unreachable|cloudflare.*5xx/i.test(message) ||
    /Streamable HTTP error/i.test(message) ||
    /fetch failed|ECONNRESET|ETIMEDOUT|socket hang up/i.test(message)
  );
}

/** Shorten noisy Cloudflare JSON error bodies for chat UI. */
export function summarizeIntentMcpTransportError(message: string): string {
  if (/502|bad gateway|origin_bad_gateway/i.test(message)) {
    return "HTTP 502 Bad Gateway from mcp.metalift.ai — Cloudflare could not reach the Metalift origin (temporary outage). Wait ~60 seconds and retry.";
  }
  if (/503|service unavailable/i.test(message)) {
    return "HTTP 503 Service Unavailable from mcp.metalift.ai — Metalift MCP is temporarily overloaded. Wait and retry.";
  }
  if (/504|gateway timeout/i.test(message)) {
    return "HTTP 504 Gateway Timeout from mcp.metalift.ai — Metalift MCP did not respond in time. Wait and retry.";
  }
  if (message.length > 280 && /cloudflare|Streamable HTTP error/i.test(message)) {
    return "Metalift MCP transport error (Cloudflare/origin). Wait ~60 seconds and retry.";
  }
  return message;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withIntentMcpTransportRetry<T>(
  fn: () => Promise<T>,
  options?: { maxAttempts?: number; delaysMs?: number[] },
): Promise<T> {
  const maxAttempts = options?.maxAttempts ?? 3;
  const delaysMs = options?.delaysMs ?? [0, 2000, 6000];
  let lastErr: unknown;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0) {
      await sleep(delaysMs[attempt] ?? delaysMs[delaysMs.length - 1] ?? 6000);
    }
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt < maxAttempts - 1 && isRetryableIntentMcpTransportError(err)) {
        continue;
      }
      throw err;
    }
  }

  throw lastErr;
}
