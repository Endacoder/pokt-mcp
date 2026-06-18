"use client";

import { useState } from "react";

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
  onSubmitted: (hash: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const intent = preview.intent as { params?: Array<{ to?: string; value?: string }> } | undefined;
  const to = intent?.params?.[0]?.to;
  const value = intent?.params?.[0]?.value;

  async function confirmSend() {
    if (!walletAddress || !window.ethereum || !to) return;
    setBusy(true);
    try {
      const previewResp = await fetch(`${apiUrl}/wallet/tx/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chain,
          from: walletAddress,
          to,
          value: value ? String(Number(BigInt(value)) / 1e18) : "0",
        }),
      });
      const previewJson = await previewResp.json();
      const tx = previewJson.transaction;
      const hash = (await window.ethereum.request({
        method: "eth_sendTransaction",
        params: [tx],
      })) as string;
      onSubmitted(hash);
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-md rounded-lg border border-slate-700 bg-slate-900 p-4">
        <h2 className="mb-2 text-lg font-semibold">Confirm transaction</h2>
        <div className="space-y-2 text-sm text-slate-300">
          <p>
            <span className="text-slate-500">To:</span> {to ?? "unknown"}
          </p>
          <p>
            <span className="text-slate-500">Value (wei hex):</span> {value ?? "0x0"}
          </p>
          <p>
            <span className="text-slate-500">Chain:</span> {chain}
          </p>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button className="rounded-md border border-slate-700 px-3 py-2 text-sm" onClick={onClose}>
            Reject
          </button>
          <button
            className="rounded-md bg-rose-600 px-3 py-2 text-sm disabled:opacity-50"
            disabled={busy || !walletAddress}
            onClick={confirmSend}
          >
            {busy ? "Signing..." : "Confirm & Send"}
          </button>
        </div>
      </div>
    </div>
  );
}

declare global {
  interface Window {
    ethereum?: {
      request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
    };
  }
}
