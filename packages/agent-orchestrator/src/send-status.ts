import { resolveChain } from "@pokt-mcp/pocket-client";
import type { LastSendTransaction, SessionContext } from "@pokt-mcp/shared";
import { isSendStatusPhrase, isSessionTxHashQuery, isVagueStatusFollowUp, pollTxLookup, wantsSend } from "@pokt-mcp/nl-rpc";
import type { PocketClient } from "@pokt-mcp/pocket-client";
import { isSwapStatusQuery } from "./intent-swap-status.js";
import type { AgentEvent } from "./types.js";

type TxReceipt = {
  status?: string;
  blockNumber?: string;
  transactionHash?: string;
};

export function isSendStatusQuery(message: string, sessionContext?: SessionContext): boolean {
  if (wantsSend(message)) return false;
  if (isSwapStatusQuery(message, sessionContext)) return false;
  const q = message.trim();
  if (/\bswap\b/i.test(q)) return false;
  if (isSendStatusPhrase(q)) return true;
  if (sessionContext?.lastSendTx && isVagueStatusFollowUp(q)) return true;
  if (isSessionTxHashQuery(q, sessionContext)) return true;
  return false;
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

    const polled = await pollTxLookup(
      pocket,
      last.chain,
      last.txHash,
      "eth_getTransactionReceipt",
      { timeoutMs: 60_000, pollIntervalMs: 2_000 },
    );
    const receipt = (polled.result as TxReceipt | null) ?? null;
    const status = receipt ? receiptStatus(receipt) : "pending";
    let answer = formatSendStatusAnswer(last, receipt);
    if (!receipt) {
      answer += [
        "",
        polled.polled
          ? "The transaction is not visible on Pocket RPC yet. The wallet returned a hash, but it may not have been broadcast — verify on the block explorer or retry the send."
          : "Receipt not available yet — the transfer may still be pending.",
      ].join("\n");
    }

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
