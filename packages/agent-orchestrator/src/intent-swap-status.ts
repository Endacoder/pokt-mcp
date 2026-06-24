import type { IntentMcpConfig, LastSwapIntent, SessionContext } from "@pokt-mcp/shared";
import { isSwapStatusPhrase, isVagueStatusFollowUp } from "@pokt-mcp/nl-rpc";
import { createIntentMcpSwapClient } from "./intent-mcp-client.js";
import { parseSwapExecutionQuery } from "./intent-swap.js";
import type { AgentEvent } from "./types.js";

export function isSwapStatusQuery(message: string, sessionContext?: SessionContext): boolean {
  if (parseSwapExecutionQuery(message)) return false;
  const q = message.trim();
  if (isSwapStatusPhrase(q)) return true;
  if (sessionContext?.lastSwapIntent && isVagueStatusFollowUp(q)) return true;
  return false;
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
