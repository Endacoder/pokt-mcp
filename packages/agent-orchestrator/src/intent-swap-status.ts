import type { IntentMcpConfig, LastSwapIntent, SessionContext } from "@pokt-mcp/shared";
import { createIntentMcpSwapClient } from "./intent-mcp-client.js";
import { parseSwapExecutionQuery } from "./intent-swap.js";
import type { AgentEvent } from "./types.js";

const SWAP_STATUS_PATTERNS = [
  /\b(did|was|has|have)\s+(?:that|the|my|it)\s+swap\b/i,
  /\b(?:swap|trade)\s+(?:status|succeed(?:ed)?|successful|complete(?:d)?|done|fail(?:ed)?|go through)\b/i,
  /\bdid\s+(?:that|it|the swap)\s+(?:work|succeed|go through|complete)\b/i,
  /\b(?:check|what(?:'s| is))\s+(?:the\s+)?swap\s+status\b/i,
  /\b(?:is|was)\s+(?:my|the|that)\s+swap\s+(?:done|complete|successful|successful)\b/i,
];

export function isSwapStatusQuery(message: string): boolean {
  if (parseSwapExecutionQuery(message)) return false;
  const q = message.trim();
  return SWAP_STATUS_PATTERNS.some((pattern) => pattern.test(q));
}

function extractStatusField(raw: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = raw[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

export function formatSwapStatusAnswer(
  last: LastSwapIntent | undefined,
  raw: Record<string, unknown>,
): string {
  const status = extractStatusField(raw, "status", "state") ?? last?.status ?? "unknown";
  const txHash =
    extractStatusField(raw, "txHash", "transactionHash", "hash") ?? last?.txHash;
  const normalized = status.toLowerCase();

  const lines: string[] = [];
  if (["completed", "success", "successful", "filled", "executed"].includes(normalized)) {
    lines.push("Your swap completed successfully.");
  } else if (["failed", "error", "reverted", "cancelled", "canceled"].includes(normalized)) {
    lines.push("Your swap failed.");
    const reason = extractStatusField(raw, "error", "failureReason", "message");
    if (reason && reason.toLowerCase() !== normalized) {
      lines.push(`Reason: ${reason}`);
    }
  } else if (
    ["pending", "submitted", "processing", "open", "awaiting", "in_progress", "in progress"].includes(
      normalized,
    )
  ) {
    lines.push("Your swap is still processing.");
  } else {
    lines.push(`Swap status: ${status}.`);
  }

  if (last?.tokenIn && last?.tokenOut) {
    const pair =
      last.amountIn != null && last.amountIn !== ""
        ? `${last.amountIn} ${last.tokenIn} → ${last.tokenOut}`
        : `${last.tokenIn} → ${last.tokenOut}`;
    lines.push(`Pair: ${pair}`);
  }

  if (last?.chainName) {
    lines.push(`Chain: ${last.chainName}`);
  }
  if (txHash) {
    lines.push(`Transaction: ${txHash}`);
  }
  if (last?.intentId) {
    lines.push(`Intent: ${last.intentId}`);
  }

  return lines.join("\n");
}

export async function* runIntentSwapStatusRoute(
  sessionContext: SessionContext,
  config: IntentMcpConfig,
  onSessionUpdate?: (patch: Partial<SessionContext>) => void,
): AsyncGenerator<AgentEvent> {
  const intentId = sessionContext.lastSwapIntent?.intentId;
  if (!intentId) {
    yield {
      type: "error",
      data: {
        message:
          "No recent swap found in this session. Submit a swap first, then ask about its status. If you just signed, try again in a few seconds.",
        code: "SWAP_INTENT_NOT_FOUND",
      },
    };
    yield { type: "done", data: {} };
    return;
  }

  const client = createIntentMcpSwapClient(config);
  const start = Date.now();

  try {
    yield {
      type: "tool",
      data: {
        tool: "intent-mcp.get_intent_status",
        input: { intentId },
      },
    };

    const raw = await client.getIntentStatus(intentId);
    const status = extractStatusField(raw, "status", "state");
    const txHash = extractStatusField(raw, "txHash", "transactionHash", "hash");
    const answer = formatSwapStatusAnswer(sessionContext.lastSwapIntent, raw);

    const patch: Partial<SessionContext> = {
      lastSwapIntent: {
        ...sessionContext.lastSwapIntent!,
        status: status ?? sessionContext.lastSwapIntent?.status,
        txHash: txHash ?? sessionContext.lastSwapIntent?.txHash,
      },
    };
    onSessionUpdate?.(patch);

    yield {
      type: "result",
      data: {
        route: "intent-swap-status",
        answer,
        output: raw,
        intentId,
        status: status ?? sessionContext.lastSwapIntent?.status,
        txHash: txHash ?? sessionContext.lastSwapIntent?.txHash,
        latencyMs: Date.now() - start,
      },
    };
    yield { type: "done", data: {} };
  } catch (err) {
    yield {
      type: "error",
      data: {
        message: err instanceof Error ? err.message : String(err),
        code: "SWAP_STATUS_FAILED",
        intentId,
      },
    };
    yield { type: "done", data: {} };
  } finally {
    await client.close();
  }
}
