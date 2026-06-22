import type { EthereumProvider } from "./ethereum.d";
import { isWalletRpcHttpError, walletRpcErrorMessage } from "./permit2-approval";
import { sendWalletTransaction } from "./wallet-tx";

export type WalletCall = {
  to: string;
  data: string;
  value: string;
};

type WalletBatchOptions = {
  apiUrl: string;
  chainId: number;
};

function hexChainId(chainId: number): string {
  return `0x${chainId.toString(16)}`;
}

function isWalletUserRejection(err: unknown): boolean {
  return (
    err != null &&
    typeof err === "object" &&
    "code" in err &&
    (err as { code?: number }).code === 4001
  );
}

export function transactionToWalletCall(tx: Record<string, unknown>): WalletCall | null {
  if (typeof tx.to !== "string" || !tx.to.startsWith("0x")) return null;
  const data = typeof tx.data === "string" && tx.data.startsWith("0x") ? tx.data : "0x";
  const valueRaw = tx.value;
  let value = "0x0";
  if (valueRaw != null && valueRaw !== "" && valueRaw !== "0" && valueRaw !== 0 && valueRaw !== "0x0") {
    if (typeof valueRaw === "string" && valueRaw.startsWith("0x")) {
      value = valueRaw;
    } else if (typeof valueRaw === "number") {
      value = `0x${valueRaw.toString(16)}`;
    } else if (typeof valueRaw === "bigint") {
      value = `0x${valueRaw.toString(16)}`;
    } else if (typeof valueRaw === "string") {
      try {
        value = `0x${BigInt(valueRaw).toString(16)}`;
      } catch {
        value = "0x0";
      }
    }
  }
  return { to: tx.to, data, value };
}

/** Parse wallet_getCapabilities for EIP-5792 atomic batch support. */
export function parseAtomicBatchSupported(
  capabilities: unknown,
  chainId: number,
): boolean {
  if (!capabilities || typeof capabilities !== "object") return false;
  const chainHex = hexChainId(chainId);
  const entry =
    (capabilities as Record<string, unknown>)[chainHex] ??
    (capabilities as Record<string, unknown>)[String(chainId)];
  if (!entry || typeof entry !== "object") return false;
  const atomic = (entry as Record<string, unknown>).atomic;
  if (!atomic || typeof atomic !== "object") return false;
  const status = (atomic as Record<string, unknown>).status;
  return status === "supported" || status === "ready";
}

export async function walletSupportsAtomicBatch(
  provider: EthereumProvider,
  walletAddress: string,
  chainId: number,
): Promise<boolean> {
  try {
    const caps = await provider.request({
      method: "wallet_getCapabilities",
      params: [walletAddress, [hexChainId(chainId)]],
    });
    return parseAtomicBatchSupported(caps, chainId);
  } catch {
    return false;
  }
}

function extractBatchId(response: unknown): string | undefined {
  if (typeof response === "string" && response.startsWith("0x")) return response;
  if (!response || typeof response !== "object") return undefined;
  const id = (response as { id?: unknown }).id;
  return typeof id === "string" && id.startsWith("0x") ? id : undefined;
}

function extractReceiptTxHash(receipt: unknown): string | undefined {
  if (!receipt || typeof receipt !== "object") return undefined;
  const hash = (receipt as { transactionHash?: unknown }).transactionHash;
  return typeof hash === "string" && hash.startsWith("0x") ? hash : undefined;
}

function extractReceiptStatus(receipt: unknown): string | undefined {
  if (!receipt || typeof receipt !== "object") return undefined;
  const status = (receipt as { status?: unknown }).status;
  return typeof status === "string" ? status : undefined;
}

async function waitForWalletCallsConfirmation(
  provider: EthereumProvider,
  batchId: string,
  maxWaitMs = 120_000,
): Promise<string> {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const statusResponse = (await provider.request({
      method: "wallet_getCallsStatus",
      params: [batchId],
    })) as {
      status?: string;
      receipts?: unknown[];
    };

    const status = statusResponse?.status?.toUpperCase();
    const receipts = Array.isArray(statusResponse?.receipts) ? statusResponse.receipts : [];

    if (status === "CONFIRMED" && receipts.length > 0) {
      for (const receipt of receipts) {
        if (extractReceiptStatus(receipt) === "0x0") {
          throw new Error("Swap batch failed on-chain. Request a new quote and try again.");
        }
      }
      const lastHash = extractReceiptTxHash(receipts[receipts.length - 1]);
      if (lastHash) return lastHash;
    }

    if (status === "FAILED" || status === "REVERTED") {
      throw new Error("Swap batch failed in wallet. Request a new quote and try again.");
    }

    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  throw new Error("Swap batch is still pending. Wait for confirmation in your wallet, then try again.");
}

async function sendAtomicWalletCalls(
  provider: EthereumProvider,
  walletAddress: string,
  txs: Record<string, unknown>[],
  chainId: number,
): Promise<string> {
  const calls: WalletCall[] = [];
  for (const tx of txs) {
    const call = transactionToWalletCall(tx);
    if (!call) throw new Error("Invalid transaction in swap batch.");
    calls.push(call);
  }

  let batchResponse: unknown;
  try {
    batchResponse = await provider.request({
      method: "wallet_sendCalls",
      params: [
        {
          version: "2.0.0",
          chainId: hexChainId(chainId),
          from: walletAddress,
          atomicRequired: true,
          calls,
        },
      ],
    });
  } catch (err) {
    if (isWalletUserRejection(err)) {
      const rejection = new Error("Wallet transaction cancelled.");
      (rejection as Error & { code: number }).code = 4001;
      throw rejection;
    }
    if (isWalletRpcHttpError(err)) {
      throw new Error(walletRpcErrorMessage(chainId));
    }
    throw err;
  }

  const batchId = extractBatchId(batchResponse);
  if (!batchId) {
    throw new Error("Wallet did not return a batch id for atomic swap.");
  }

  return waitForWalletCallsConfirmation(provider, batchId);
}

export type SendWalletTransactionsOptions = WalletBatchOptions & {
  waitForConfirmation: (txHash: string) => Promise<void>;
};

/**
 * Send multiple swap transactions — one EIP-5792 batch when supported, else sequential sends.
 * Returns the last transaction hash (typically the swap execution tx).
 */
export async function sendWalletTransactions(
  provider: EthereumProvider,
  walletAddress: string,
  txs: Record<string, unknown>[],
  options: SendWalletTransactionsOptions,
): Promise<string> {
  if (txs.length === 0) return "";

  if (txs.length === 1) {
    const hash = await sendWalletTransaction(provider, walletAddress, txs[0]!, {
      apiUrl: options.apiUrl,
      chainId: options.chainId,
    });
    await options.waitForConfirmation(hash);
    return hash;
  }

  const batchSupported = await walletSupportsAtomicBatch(provider, walletAddress, options.chainId);
  if (batchSupported) {
    try {
      return await sendAtomicWalletCalls(provider, walletAddress, txs, options.chainId);
    } catch (err) {
      if (isWalletUserRejection(err)) throw err;
      /* fall back to sequential eth_sendTransaction */
    }
  }

  let lastHash = "";
  for (const tx of txs) {
    lastHash = await sendWalletTransaction(provider, walletAddress, tx, {
      apiUrl: options.apiUrl,
      chainId: options.chainId,
    });
    await options.waitForConfirmation(lastHash);
  }
  return lastHash;
}
