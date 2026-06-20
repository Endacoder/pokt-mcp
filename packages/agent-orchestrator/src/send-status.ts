import { resolveChain } from "@pokt-mcp/pocket-client";
import type { LastSendTransaction, SessionContext } from "@pokt-mcp/shared";
import { wantsSend } from "@pokt-mcp/nl-rpc";
import type { PocketClient } from "@pokt-mcp/pocket-client";
import { isSwapStatusQuery } from "./intent-swap-status.js";
import type { AgentEvent } from "./types.js";

const SEND_STATUS_PATTERNS = [
  /\b(did|was|has|have)\s+(?:that|the|my|it)\s+(?:send|transfer|transaction|tx|payment)\b/i,
  /\b(?:send|transfer|transaction|tx|payment)\s+(?:status|succeed(?:ed)?|successful|complete(?:d)?|done|fail(?:ed)?|go through|confirm(?:ed)?|mined)\b/i,
  /\bdid\s+(?:that|it|the)\s+(?:send|transfer|payment|transaction|tx)\s+(?:work|succeed|go through|complete|confirm)\b/i,
  /\b(?:check|what(?:'s| is))\s+(?:the\s+)?(?:send|transfer|transaction|tx)\s+status\b/i,
  /\b(?:is|was)\s+(?:my|the|that)\s+(?:send|transfer|transaction|tx|payment)\s+(?:done|complete|successful|confirmed|mined)\b/i,
];

type TxReceipt = {
  status?: string;
  blockNumber?: string;
  transactionHash?: string;
};

export function isSendStatusQuery(message: string): boolean {
  if (wantsSend(message)) return false;
  if (isSwapStatusQuery(message)) return false;
  const q = message.trim();
  if (/\bswap\b/i.test(q)) return false;
  return SEND_STATUS_PATTERNS.some((pattern) => pattern.test(q));
}

function receiptStatus(receipt: TxReceipt | null | undefined): LastSendTransaction["status"] {
  if (!receipt) return "pending";
  if (receipt.status === "0x1") return "success";
  if (receipt.status === "0x0") return "reverted";
  return "pending";
}

export function formatSendStatusAnswer(
  last: LastSendTransaction | undefined,
  receipt: TxReceipt | null | undefined,
): string {
  const status = receiptStatus(receipt) ?? last?.status ?? "submitted";
  const txHash = last?.txHash ?? receipt?.transactionHash;
  const lines: string[] = [];

  if (status === "success") {
    lines.push("Your transfer completed successfully.");
  } else if (status === "reverted") {
    lines.push("Your transfer was mined but reverted on-chain.");
  } else if (status === "pending") {
    lines.push("Your transfer is still pending — not confirmed on-chain yet.");
  } else {
    lines.push(`Transfer status: ${status}.`);
  }

  if (last?.valueNative && last?.nativeSymbol) {
    lines.push(`Amount: ${last.valueNative} ${last.nativeSymbol}`);
  }
  if (last?.to) {
    lines.push(`To: ${last.to}`);
  }
  if (last?.chainName ?? last?.chain) {
    lines.push(`Chain: ${last?.chainName ?? last?.chain}`);
  }
  if (txHash) {
    lines.push(`Transaction: ${txHash}`);
  }
  if (receipt?.blockNumber) {
    lines.push(`Block: ${BigInt(receipt.blockNumber).toString()}`);
  }
  if (last?.explorerUrl && txHash) {
    lines.push(`Explorer: ${last.explorerUrl}`);
  }

  return lines.join("\n");
}

export async function* runSendStatusRoute(
  sessionContext: SessionContext,
  pocket: PocketClient,
  onSessionUpdate?: (patch: Partial<SessionContext>) => void,
): AsyncGenerator<AgentEvent> {
  const last = sessionContext.lastSendTx;
  if (!last?.txHash || !last.chain) {
    yield {
      type: "error",
      data: {
        message:
          "No recent send found in this session. Submit a transfer first, then ask about its status. If you just signed, try again in a few seconds.",
        code: "SEND_TX_NOT_FOUND",
      },
    };
    yield { type: "done", data: {} };
    return;
  }

  const start = Date.now();
  const chainInfo = resolveChain(last.chain);

  try {
    yield {
      type: "tool",
      data: {
        tool: "eth_getTransactionReceipt",
        input: { chain: last.chain, txHash: last.txHash },
      },
    };

    const resp = await pocket.rpc<TxReceipt | null>(last.chain, "eth_getTransactionReceipt", [
      last.txHash,
    ]);
    const receipt = resp.result ?? null;
    const status = receiptStatus(receipt);
    const answer = formatSendStatusAnswer(last, receipt);

    onSessionUpdate?.({
      lastSendTx: {
        ...last,
        status,
      },
    });

    yield {
      type: "result",
      data: {
        route: "send-status",
        answer,
        output: { receipt, status },
        txHash: last.txHash,
        chain: last.chain,
        chainName: chainInfo?.name ?? last.chainName,
        latencyMs: Date.now() - start,
      },
    };
    yield { type: "done", data: {} };
  } catch (err) {
    yield {
      type: "error",
      data: {
        message: err instanceof Error ? err.message : String(err),
        code: "SEND_STATUS_FAILED",
        txHash: last.txHash,
      },
    };
    yield { type: "done", data: {} };
  }
}
