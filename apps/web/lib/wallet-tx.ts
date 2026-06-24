import { applyGasSafetyBufferHex } from "@pokt-mcp/shared/gas-buffer";
import { previewTransaction } from "./api";
import { slugFromChainId } from "./chain-config";
import { isWalletRpcHttpError, walletRpcErrorMessage } from "./permit2-approval";

/** Normalize RPC gas quantity to hex (Uniswap returns decimal gas limits). */
export function normalizeGasQuantity(gas: string | number | bigint | undefined): string | undefined {
  if (gas == null) return undefined;
  if (typeof gas === "bigint") return `0x${gas.toString(16)}`;
  if (typeof gas === "number") {
    if (!Number.isFinite(gas) || gas <= 0) return undefined;
    return `0x${Math.trunc(gas).toString(16)}`;
  }
  const trimmed = gas.trim();
  if (!trimmed) return undefined;
  if (trimmed.startsWith("0x")) return trimmed;
  try {
    return `0x${BigInt(trimmed).toString(16)}`;
  } catch {
    return undefined;
  }
}

function hexChainId(chainId: number): string {
  return `0x${chainId.toString(16)}`;
}

function hexNonce(nonce: number): string {
  return `0x${nonce.toString(16)}`;
}

function previewValueFromTx(tx: Record<string, unknown>): string {
  const v = tx.value;
  if (v == null || v === "" || v === "0x" || v === "0x0" || v === "0" || v === 0) return "0";
  if (typeof v === "string") return v;
  if (typeof v === "number") return `0x${v.toString(16)}`;
  if (typeof v === "bigint") return `0x${v.toString(16)}`;
  return "0";
}

function gasLimitFromTx(tx: Record<string, unknown>): string | undefined {
  const g = tx.gas ?? tx.gasLimit;
  if (typeof g === "string" && g.startsWith("0x")) return g;
  if (typeof g === "string" && /^\d+$/.test(g)) return `0x${BigInt(g).toString(16)}`;
  if (typeof g === "number") return `0x${g.toString(16)}`;
  return undefined;
}

/** Fill gas/nonce via Pocket RPC preview so MetaMask does minimal RPC work. */
export async function enrichTransactionForWallet(
  apiUrl: string,
  chainId: number,
  walletAddress: string,
  tx: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const chain = slugFromChainId(chainId);
  if (!chain || typeof tx.to !== "string") return tx;

  const gasLimitParam = (() => {
    const hex = gasLimitFromTx(tx);
    if (!hex) return undefined;
    return hex.startsWith("0x") ? BigInt(hex).toString() : hex;
  })();

  const preview = await previewTransaction(apiUrl, {
    chain,
    from: walletAddress,
    to: tx.to,
    value: previewValueFromTx(tx),
    data: typeof tx.data === "string" ? tx.data : "0x",
    gasLimit: gasLimitParam,
  });

  if (preview.error || !preview.transaction) {
    const gas = gasLimitFromTx(tx);
    if (gas) return { ...tx, gas: applyGasSafetyBufferHex(gas) };
    return tx;
  }

  const built = preview.transaction;
  return {
    ...tx,
    from: built.from ?? walletAddress,
    to: built.to,
    data: built.data ?? tx.data,
    value: tx.value ?? built.value ?? "0x0",
    gas: built.gas ?? gasLimitFromTx(tx) ?? tx.gas,
    maxFeePerGas: built.maxFeePerGas ?? tx.maxFeePerGas,
    maxPriorityFeePerGas: built.maxPriorityFeePerGas ?? tx.maxPriorityFeePerGas,
    nonce: built.nonce != null ? hexNonce(built.nonce) : tx.nonce,
    chainId: hexChainId(chainId),
    type: "0x2",
  };
}

function isWalletUserRejection(err: unknown): boolean {
  return (
    err != null &&
    typeof err === "object" &&
    "code" in err &&
    (err as { code?: number }).code === 4001
  );
}

export async function sendWalletTransaction(
  provider: NonNullable<Window["ethereum"]>,
  walletAddress: string,
  tx: Record<string, unknown>,
  options?: { apiUrl?: string; chainId?: number },
): Promise<string> {
  if (!options?.apiUrl || options.chainId == null) {
    throw new Error("Cannot send swap transaction without Pocket RPC access.");
  }

  let payload: Record<string, unknown> = { ...tx, from: tx.from ?? walletAddress };
  const gasHex = gasLimitFromTx(payload);
  if (gasHex) payload.gas = gasHex;
  if (payload.chainId != null && typeof payload.chainId === "number") {
    payload.chainId = hexChainId(payload.chainId);
  }

  try {
    payload = await enrichTransactionForWallet(
      options.apiUrl,
      options.chainId,
      walletAddress,
      payload,
    );
  } catch (err) {
    throw new Error(
      err instanceof Error
        ? `Failed to prepare transaction via Pocket RPC: ${err.message}`
        : "Failed to prepare transaction via Pocket RPC",
    );
  }

  // MetaMask does not support eth_signTransaction (-32004). Must use eth_sendTransaction.
  try {
    return (await provider.request({
      method: "eth_sendTransaction",
      params: [payload],
    })) as string;
  } catch (err) {
    if (isWalletUserRejection(err)) {
      const rejection = new Error("Wallet transaction cancelled.");
      (rejection as Error & { code: number }).code = 4001;
      throw rejection;
    }
    if (isWalletRpcHttpError(err)) {
      throw new Error(walletRpcErrorMessage(options.chainId));
    }
    throw err;
  }
}
