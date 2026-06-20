"use client";

import { useEffect, useState } from "react";
import type { TxPreviewResponse } from "../lib/api";
import { sessionHeaders, ensureSessionToken } from "../lib/session";

const MAX_SEND_ETH = parseFloat(process.env.NEXT_PUBLIC_MAX_SEND_VALUE_ETH ?? "1.0");

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
  }) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [txPreview, setTxPreview] = useState<TxPreviewResponse | null>(null);
  const intent = preview.intent as { params?: Array<{ to?: string; value?: string }> } | undefined;
  const to = intent?.params?.[0]?.to;
  const value = intent?.params?.[0]?.value;
  const valueEth = value ? weiHexToEth(value) : "0";
  const nearLimit = parseFloat(valueEth) >= MAX_SEND_ETH * 0.9;

  useEffect(() => {
    if (walletAddress && to) {
      previewTransaction(apiUrl, { chain, from: walletAddress, to, value: valueEth })
        .then(setTxPreview)
        .catch(() => undefined);
    }
  }, [apiUrl, chain, walletAddress, to, valueEth]);

  async function confirmSend() {
    if (!walletAddress || !window.ethereum || !to) return;
    setBusy(true);
    try {
      const previewJson = txPreview;
      if (!previewJson || previewJson.error) {
        throw new Error(previewJson?.error ?? "Loading preview...");
      }
      const tx = previewJson.transaction;
      if (!tx) throw new Error("No transaction preview");

      const hash = (await window.ethereum.request({
        method: "eth_sendTransaction",
        params: [
          {
            from: tx.from ?? walletAddress,
            to: tx.to,
            value: tx.value,
            gas: tx.gas,
            maxFeePerGas: tx.maxFeePerGas,
            chainId: tx.chainId ? `0x${tx.chainId.toString(16)}` : undefined,
          },
        ],
      })) as string;
      onSubmitted({
        hash,
        explorerUrl: previewJson.explorerUrl
          ? `${previewJson.explorerUrl.replace(/\/$/, "")}/tx/${hash}`
          : undefined,
        to,
        valueNative: valueEth,
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
            <span className="text-pocket-muted">To:</span>{" "}
            <span className="break-all font-mono text-xs text-pocket-foreground">{to ?? "unknown"}</span>
          </p>
          <p>
            <span className="text-pocket-muted">Amount:</span>{" "}
            <span className="text-pocket-foreground">{valueEth} native</span>
          </p>
          <p>
            <span className="text-pocket-muted">Chain:</span>{" "}
            <span className="text-pocket-foreground">{chain}</span>
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

async function previewTransaction(
  apiUrl: string,
  body: { chain: string; from: string; to: string; value?: string },
) {
  await ensureSessionToken(apiUrl);
  const res = await fetch(`${apiUrl}/wallet/tx/preview`, {
    method: "POST",
    headers: sessionHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  });
  return res.json() as Promise<TxPreviewResponse>;
}
