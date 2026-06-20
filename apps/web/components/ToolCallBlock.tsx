"use client";

import { useState } from "react";
import type { ToolCall } from "../lib/types";

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="currentColor"
      className={`h-4 w-4 transition-transform ${open ? "rotate-90" : ""}`}
      aria-hidden
    >
      <path
        fillRule="evenodd"
        d="M7.21 14.77a.75.75 0 0 1 .02-1.06L10.94 10 7.23 6.29a.75.75 0 1 1 1.06-1.06l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.75.75 0 0 1-1.06-.02Z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function formatValue(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "object") {
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

const TOOL_LABELS: Record<string, string> = {
  pocket_query: "Natural language query",
  pocket_query_nl: "Parse natural language query",
  pocket_agent_query: "Multi-step agent query",
  rpc_call: "RPC call",
  list_chains: "List chains",
  list_methods: "List RPC methods",
  get_chain: "Get chain info",
  explain_rpc: "Explain RPC call",
};

export function ToolCallBlock({
  toolCall,
  defaultOpen = false,
}: {
  toolCall: ToolCall;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  const label =
    toolCall.status === "error"
      ? "Error calling"
      : toolCall.status === "running"
        ? "Calling"
        : "Called";

  const displayName = TOOL_LABELS[toolCall.tool] ?? toolCall.tool;

  return (
    <div className="overflow-hidden rounded-xl border border-pocket-border bg-pocket-elevated/50 text-sm">
      <button
        type="button"
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-pocket-muted transition-colors hover:bg-pocket-accent-dim/50"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <ChevronIcon open={open} />
        <span>
          {label} tool{" "}
          <span className="font-mono text-pocket-accent">{displayName}</span>
          {toolCall.latencyMs != null && (
            <span className="ml-2 text-xs text-pocket-muted/70">{toolCall.latencyMs}ms</span>
          )}
        </span>
      </button>
      {open && (
        <div className="space-y-2 border-t border-pocket-border px-3 py-2">
          {toolCall.input != null && (
            <div>
              <p className="mb-1 text-xs font-medium uppercase tracking-wide text-pocket-muted">Input</p>
              <pre className="max-h-32 overflow-auto rounded-lg border border-pocket-border bg-pocket-surface p-2 font-mono text-xs text-pocket-muted">
                {formatValue(toolCall.input)}
              </pre>
            </div>
          )}
          {toolCall.intent != null && (
            <div>
              <p className="mb-1 text-xs font-medium uppercase tracking-wide text-pocket-muted">Intent</p>
              <pre className="max-h-32 overflow-auto rounded-lg border border-pocket-border bg-pocket-surface p-2 font-mono text-xs text-pocket-muted">
                {formatValue(toolCall.intent)}
              </pre>
            </div>
          )}
          {toolCall.output != null && (
            <div>
              <p className="mb-1 text-xs font-medium uppercase tracking-wide text-pocket-muted">Output</p>
              <pre className="max-h-32 overflow-auto rounded-lg border border-pocket-border bg-pocket-surface p-2 font-mono text-xs text-pocket-muted">
                {formatValue(toolCall.output)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
