"use client";

import { useCallback, useMemo, useState } from "react";
import { TxConfirmModal } from "../components/TxConfirmModal";
import { WalletButton } from "../components/WalletButton";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

type Message = { role: "user" | "assistant"; content: string };

declare global {
  interface Window {
    ethereum?: {
      request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
    };
  }
}

export default function HomePage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [chain, setChain] = useState("eth");
  const [loading, setLoading] = useState(false);
  const [walletAddress, setWalletAddress] = useState<string>();
  const [pendingTx, setPendingTx] = useState<Record<string, unknown> | null>(null);

  const chains = useMemo(
    () => ["eth", "base", "poly", "arb-one", "opt", "avax", "bsc", "linea"],
    [],
  );

  const sendChat = useCallback(async () => {
    if (!input.trim()) return;
    const userMessage = input.trim();
    setInput("");
    setMessages((m) => [...m, { role: "user", content: userMessage }]);
    setLoading(true);

    let assistant = "";
    try {
      const res = await fetch(`${API_URL}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: userMessage, chain }),
      });

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      if (!reader) throw new Error("No response body");

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value);
        for (const line of chunk.split("\n")) {
          if (!line.startsWith("data:")) continue;
          const payload = line.slice(5).trim();
          if (!payload) continue;
          try {
            const parsed = JSON.parse(payload) as { text?: string };
            if (parsed.text) assistant += parsed.text;
            const eventData = JSON.parse(payload) as Record<string, unknown>;
            if (eventData.requiresConfirmation) {
              setPendingTx(eventData);
            }
          } catch {
            // ignore partial SSE chunks
          }
        }
      }

      if (!assistant) assistant = "Query processed. Check structured result in server logs or retry.";
    } catch (err) {
      assistant = err instanceof Error ? err.message : String(err);
    }

    setMessages((m) => [...m, { role: "assistant", content: assistant }]);
    setLoading(false);
  }, [input, chain]);

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-4 p-6">
      <header className="flex items-center justify-between gap-4 border-b border-slate-800 pb-4">
        <div>
          <h1 className="text-2xl font-semibold">pokt-mcp</h1>
          <p className="text-sm text-slate-400">AI agents × Pocket Network × natural language RPC</p>
        </div>
        <WalletButton
          apiUrl={API_URL}
          onConnected={(address) => {
            setWalletAddress(address);
            fetch(`${API_URL}/wallet/session`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ address, chainSlug: chain }),
            });
          }}
        />
      </header>

      <div className="flex items-center gap-2">
        <label className="text-sm text-slate-400">Chain</label>
        <select
          className="rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
          value={chain}
          onChange={(e) => setChain(e.target.value)}
        >
          {chains.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        {walletAddress && <span className="truncate text-xs text-emerald-400">{walletAddress}</span>}
      </div>

      <section className="flex-1 space-y-3 overflow-y-auto rounded-lg border border-slate-800 bg-slate-900/40 p-4">
        {messages.length === 0 && (
          <p className="text-sm text-slate-500">
            Try: &quot;latest block on Base&quot; or &quot;balance of 0x… on ethereum&quot;
          </p>
        )}
        {messages.map((m, i) => (
          <div
            key={i}
            className={`rounded-lg px-3 py-2 text-sm whitespace-pre-wrap ${
              m.role === "user" ? "bg-indigo-950/60" : "bg-slate-800/80"
            }`}
          >
            {m.content}
          </div>
        ))}
      </section>

      <div className="flex gap-2">
        <input
          className="flex-1 rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
          placeholder="Ask about any Pocket chain..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && sendChat()}
        />
        <button
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium disabled:opacity-50"
          disabled={loading}
          onClick={sendChat}
        >
          {loading ? "..." : "Send"}
        </button>
      </div>

      {pendingTx && (
        <TxConfirmModal
          preview={pendingTx}
          apiUrl={API_URL}
          chain={chain}
          walletAddress={walletAddress}
          onClose={() => setPendingTx(null)}
          onSubmitted={(hash) => {
            setMessages((m) => [...m, { role: "assistant", content: `Transaction submitted: ${hash}` }]);
            setPendingTx(null);
          }}
        />
      )}
    </main>
  );
}
