"use client";

import { useEffect, useState } from "react";
import { previewTransaction, verifySubmittedTransaction, type TxPreviewResponse } from "../lib/api";
import { ensureWalletNetworkForSwap } from "../lib/wallet-network";

const MAX_SEND_ETH = parseFloat(process.env.NEXT_PUBLIC_MAX_SEND_VALUE_ETH ?? "1.0");

type TxIntentParams = {
  to?: string;
  value?: string;
  data?: string;
  tokenSymbol?: string;
  tokenAmount?: string;
  recipient?: string;
};

function weiHexToEth(hex: string): string {
  try {
    const wei = BigInt(hex);
    return (Number(wei) / 1e18).toFixed(6).replace(/\.?0+$/, "") || "0";
  } catch {
    return hex;
  }
}

function gweiFromHex(hex?: string): string | undefined {
  if (!hex) return undefined;
  try {
    return (Number(BigInt(hex)) / 1e9).toFixed(2);
  } catch {
    return hex;
  }
}

export function TxConfirmModal({
  preview,
  apiUrl,
  chain,
  walletAddress,
  onClose,
  onSubmitted,
}: {
  preview: Record<string, unknown>;
  apiUrl: string;
  chain: string;
  walletAddress?: string;
  onClose: () => void;
  onSubmitted: (result: {
    hash: string;
    explorerUrl?: string;
    to?: string;
    valueNative?: string;
    nativeSymbol?: string;
    verified?: boolean;
    pending?: boolean;
  }) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [txPreview, setTxPreview] = useState<TxPreviewResponse | null>(null);
  const intent = preview.intent as { method?: string; chain?: string; params?: TxIntentParams[]; humanSummary?: string } | undefined;
  const txChain = intent?.chain ?? chain;
  const txParam = intent?.params?.[0];
  const isTokenSend = intent?.method === "__token_send__" || Boolean(txParam?.tokenSymbol);
  const contractTo = txParam?.to;
  const recipient = isTokenSend ? txParam?.recipient : txParam?.to;
  const valueEth = !isTokenSend && txParam?.value ? weiHexToEth(txParam.value) : "0";
  const displayAmount = isTokenSend
    ? `${txParam?.tokenAmount ?? "?"} ${txParam?.tokenSymbol ?? "TOKEN"}`
    : `${valueEth} native`;
  const nearLimit = !isTokenSend && parseFloat(valueEth) >= MAX_SEND_ETH * 0.9;

  useEffect(() => {
    if (!walletAddress || !contractTo) return;
    previewTransaction(apiUrl, {
      chain: txChain,
      from: walletAddress,
      to: contractTo,
      value: isTokenSend ? "0" : valueEth,
      data: txParam?.data,
    })
      .then(setTxPreview)
      .catch(() => undefined);
  }, [apiUrl, txChain, walletAddress, contractTo, isTokenSend, valueEth, txParam?.data]);

  async function confirmSend() {
    if (!walletAddress || !window.ethereum || !contractTo) return;
    setBusy(true);
    try {
      const previewJson = txPreview;
      if (!previewJson || previewJson.error) {
        throw new Error(previewJson?.error ?? "Loading preview...");
      }
      const tx = previewJson.transaction;
      if (!tx) throw new Error("No transaction preview");

      if (tx.chainId && window.ethereum) {
        await ensureWalletNetworkForSwap(window.ethereum, tx.chainId);
      }

      const hash = (await window.ethereum.request({
        method: "eth_sendTransaction",
        params: [
          {
            from: tx.from ?? walletAddress,
            to: tx.to,
            value: tx.value,
            data: tx.data,
            gas: tx.gas,
            maxFeePerGas: tx.maxFeePerGas,
            maxPriorityFeePerGas: tx.maxPriorityFeePerGas,
            chainId: tx.chainId ? `0x${tx.chainId.toString(16)}` : undefined,
          },
        ],
      })) as string;

      let verified = false;
      let pending = false;
      try {
        const check = await verifySubmittedTransaction(apiUrl, {
          chain: txChain,
          txHash: hash,
          timeoutMs: 20_000,
        });
        verified = check.found;
        pending = check.pending;
      } catch {
        /* verification is best-effort */
      }

      onSubmitted({
        hash,
        explorerUrl: previewJson.explorerUrl
          ? `${previewJson.explorerUrl.replace(/\/$/, "")}/tx/${hash}`
          : undefined,
        to: recipient,
        valueNative: isTokenSend ? displayAmount : valueEth,
        verified,
        pending,
      });
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl border border-pocket-border bg-pocket-surface p-5 shadow-pocket">
        <h2 className="mb-2 text-lg font-semibold text-pocket-foreground">Confirm transaction</h2>
        <div className="space-y-2 text-sm text-pocket-muted">
          <p>
            <span className="text-pocket-muted">{isTokenSend ? "Recipient:" : "To:"}</span>{" "}
            <span className="break-all font-mono text-xs text-pocket-foreground">{recipient ?? "unknown"}</span>
          </p>
          {isTokenSend && contractTo && (
            <p>
              <span className="text-pocket-muted">Token contract:</span>{" "}
              <span className="break-all font-mono text-xs text-pocket-foreground">{contractTo}</span>
            </p>
          )}
          <p>
            <span className="text-pocket-muted">Amount:</span>{" "}
            <span className="text-pocket-foreground">{displayAmount}</span>
          </p>
          <p>
            <span className="text-pocket-muted">Chain:</span>{" "}
            <span className="text-pocket-foreground">{txChain}</span>
          </p>
          {txPreview?.estimatedGas && (
            <p>
              <span className="text-pocket-muted">Est. gas:</span>{" "}
              <span className="text-pocket-foreground">{hexToDec(txPreview.estimatedGas)} units</span>
              {gweiFromHex(txPreview.transaction.maxFeePerGas)
                ? ` (~${gweiFromHex(txPreview.transaction.maxFeePerGas)} gwei max)`
                : ""}
            </p>
          )}
          {txPreview?.explorerUrl && (
            <p>
              <span className="text-pocket-muted">Explorer:</span>{" "}
              <a className="text-pocket-accent underline hover:text-pocket-cta-hover" href={txPreview.explorerUrl} target="_blank" rel="noreferrer">
                {txPreview.explorerUrl}
              </a>
            </p>
          )}
          {nearLimit && (
            <p className="text-amber-700">Warning: amount is near the {MAX_SEND_ETH} ETH send limit.</p>
          )}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button
            className="rounded-lg border border-pocket-border px-3 py-2 text-sm text-pocket-muted transition-colors hover:bg-pocket-elevated hover:text-pocket-foreground"
            onClick={onClose}
          >
            Reject
          </button>
          <button
            className="rounded-lg bg-pocket-accent px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-pocket-cta-hover disabled:opacity-50"
            disabled={busy || !walletAddress || !txPreview}
            onClick={confirmSend}
          >
            {busy ? "Signing..." : "Confirm & Send"}
          </button>
        </div>
      </div>
    </div>
  );
}

function hexToDec(hex: string): string {
  try {
    return BigInt(hex).toString();
  } catch {
    return hex;
  }
}
