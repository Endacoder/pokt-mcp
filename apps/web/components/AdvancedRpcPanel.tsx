"use client";

import { useState } from "react";
import { postRpc } from "../lib/api";

export function AdvancedRpcPanel({
  apiUrl,
  chain,
}: {
  apiUrl: string;
  chain: string;
}) {
  const [open, setOpen] = useState(false);
  const [method, setMethod] = useState("eth_blockNumber");
  const [params, setParams] = useState("[]");
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      let parsedParams: unknown[] = [];
      if (params.trim()) {
        parsedParams = JSON.parse(params) as unknown[];
      }
      const data = await postRpc(apiUrl, { chain, method, params: parsedParams });
      setResult(JSON.stringify(data, null, 2));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-pocket-border bg-pocket-elevated/60">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-3 py-2 text-sm text-pocket-muted hover:text-pocket-accent"
      >
        <span>Advanced RPC</span>
        <span>{open ? "−" : "+"}</span>
      </button>
      {open && (
        <div className="space-y-2 border-t border-pocket-border p-3">
          <input
            value={method}
            onChange={(e) => setMethod(e.target.value)}
            placeholder="eth_blockNumber"
            className="w-full rounded-lg border border-pocket-border bg-pocket-surface px-3 py-2 font-mono text-sm text-pocket-foreground"
          />
          <textarea
            value={params}
            onChange={(e) => setParams(e.target.value)}
            placeholder='[]'
            rows={3}
            className="w-full rounded-lg border border-pocket-border bg-pocket-surface px-3 py-2 font-mono text-xs text-pocket-foreground"
          />
          <button
            type="button"
            onClick={submit}
            disabled={busy}
            className="rounded-lg bg-pocket-accent px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
          >
            {busy ? "Running…" : "Run RPC"}
          </button>
          {error && <p className="text-sm text-red-300">{error}</p>}
          {result && (
            <pre className="max-h-40 overflow-auto rounded-lg border border-pocket-border bg-pocket-surface p-2 font-mono text-xs text-pocket-muted">
              {result}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
