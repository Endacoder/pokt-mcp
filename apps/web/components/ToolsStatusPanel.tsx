"use client";

import { useEffect, useState } from "react";
import { fetchChains, fetchMcpEnv } from "../lib/api";
import { INTENT_MCP_TOOLS } from "../lib/intent-mcp-config";

const POKT_MCP_TOOLS = [
  { name: "pocket_query", desc: "Primary NL query — dynamic routing" },
  { name: "pocket_agent_query", desc: "Explicit multi-step agent" },
  { name: "pocket_get_token_balance", desc: "ERC-20 balance shortcut" },
  { name: "pocket_get_nonce", desc: "Account nonce shortcut" },
  { name: "pocket_rpc_call", desc: "Advanced RPC escape hatch" },
  { name: "pocket_list_chains", desc: "List supported chains" },
  { name: "wallet_get_status", desc: "Wallet connection status" },
  { name: "wallet_send_transaction", desc: "Send tx (requires confirm)" },
];

export function ToolsStatusPanel({ apiUrl }: { apiUrl: string }) {
  const [open, setOpen] = useState(false);
  const [health, setHealth] = useState<"ok" | "error" | "loading">("loading");
  const [chainCount, setChainCount] = useState<number | null>(null);
  const [intentMcpConfigured, setIntentMcpConfigured] = useState<boolean | null>(null);

  useEffect(() => {
    if (!open) return;
    setHealth("loading");
    Promise.all([
      fetch(`${apiUrl}/health`).then((r) => (r.ok ? "ok" : "error")),
      fetchChains(apiUrl)
        .then((c) => {
          setChainCount(c.length);
          return "ok" as const;
        })
        .catch(() => "error" as const),
      fetchMcpEnv(apiUrl)
        .then((data) => {
          if (data?.intentMcp) {
            setIntentMcpConfigured(data.intentMcp.configured ?? false);
          }
        })
        .catch(() => undefined),
    ])
      .then(([h]) => setHealth(h === "ok" ? "ok" : "error"))
      .catch(() => setHealth("error"));
  }, [open, apiUrl]);

  return (
    <div className="rounded-xl border border-pocket-border bg-pocket-elevated/60">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-3 py-2 text-sm text-pocket-muted hover:text-pocket-accent"
      >
        <span>MCP Tools &amp; Status</span>
        <span>{open ? "−" : "+"}</span>
      </button>
      {open && (
        <div className="space-y-3 border-t border-pocket-border p-3">
          <div className="flex items-center gap-2 text-sm">
            <span
              className={`h-2 w-2 rounded-full ${
                health === "ok"
                  ? "bg-pocket-success"
                  : health === "loading"
                    ? "bg-pocket-warning"
                    : "bg-pocket-error"
              }`}
            />
            <span className="text-pocket-muted">
              API {health === "loading" ? "checking…" : health === "ok" ? "healthy" : "unreachable"}
              {chainCount != null && health === "ok" && ` · ${chainCount} chains`}
            </span>
          </div>

          <div>
            <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-pocket-muted">
              pokt-mcp
            </p>
            <ul className="space-y-1">
              {POKT_MCP_TOOLS.map((t) => (
                <li key={t.name} className="flex items-start gap-2 text-xs">
                  <span className="font-mono text-pocket-accent">{t.name}</span>
                  <span className="text-pocket-muted">{t.desc}</span>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <p className="mb-1 flex items-center gap-2 text-[10px] font-medium uppercase tracking-wide text-pocket-muted">
              Third-party optional — intent-mcp (Metalift)
              {intentMcpConfigured != null && (
                <span className={intentMcpConfigured ? "text-emerald-600" : "text-amber-600"}>
                  ({intentMcpConfigured ? "ready" : "needs INTENT_MCP_API_KEY"})
                </span>
              )}
            </p>
            <ul className="space-y-1">
              {INTENT_MCP_TOOLS.map((t) => (
                <li key={t.name} className="flex items-start gap-2 text-xs">
                  <span className="font-mono text-pocket-accent">{t.name}</span>
                  <span className="text-pocket-muted">{t.desc}</span>
                </li>
              ))}
            </ul>
          </div>

          <a
            href="https://github.com/Endacoder/pokt-mcp/blob/main/examples/cursor-mcp.json"
            target="_blank"
            rel="noreferrer"
            className="inline-block text-xs text-pocket-accent hover:underline"
          >
            pokt-mcp Cursor config →
          </a>
          <a
            href="https://github.com/Endacoder/pokt-mcp/blob/main/docs/USE_CASES.md"
            target="_blank"
            rel="noreferrer"
            className="ml-3 inline-block text-xs text-pocket-accent hover:underline"
          >
            Use cases →
          </a>
          <a
            href="https://github.com/Endacoder/pokt-mcp/blob/main/docs/intent-mcp-agent-guide.md"
            target="_blank"
            rel="noreferrer"
            className="ml-3 inline-block text-xs text-pocket-accent hover:underline"
          >
            Third-party swap guide →
          </a>
        </div>
      )}
    </div>
  );
}
