"use client";

import { useCallback, useEffect, useState } from "react";
import {
  createMcpServerId,
  exportCursorMcpConfig,
  formatArgsInput,
  loadAndPersistMcpServers,
  mergeDefaultMcpServers,
  newSseServerDraftUrl,
  parseArgsInput,
  saveMcpServers,
  testMcpSseConnection,
  type McpConnectionStatus,
  type McpServerEntry,
  type McpTransport,
} from "../lib/mcp-config";
import { fetchMcpEnv, type McpEnvStatus } from "../lib/api";
import { getApiUrl } from "../lib/api-url";
import { isIntentServerEntry } from "../lib/intent-mcp-config";

type ConnectionMap = Record<string, { status: McpConnectionStatus; message?: string }>;

const API_URL = getApiUrl();

export function McpConfigPanel() {
  const [servers, setServers] = useState<McpServerEntry[]>([]);
  const [connections, setConnections] = useState<ConnectionMap>({});
  const [mcpEnv, setMcpEnv] = useState<McpEnvStatus | null>(null);
  const [adding, setAdding] = useState(false);
  const [copied, setCopied] = useState(false);
  const [draft, setDraft] = useState<Partial<McpServerEntry>>({
    name: "",
    transport: "sse",
    url: "",
    command: "node",
    args: [],
    enabled: true,
  });

  useEffect(() => {
    setServers(loadAndPersistMcpServers());
    fetchMcpEnv(API_URL)
      .then((data) => {
        if (!data) return;
        setMcpEnv(data);

        const serverEntry = data.intentMcp?.serverEntry as McpServerEntry | undefined;
        if (!serverEntry) return;

        setServers((prev) => {
          const next = mergeDefaultMcpServers(prev).map((s) =>
            isIntentServerEntry(s)
              ? { ...serverEntry, enabled: s.enabled, env: { ...serverEntry.env, ...s.env } }
              : s,
          );
          saveMcpServers(next);
          return next;
        });
      })
      .catch(() => undefined);
  }, []);

  const persist = useCallback((next: McpServerEntry[]) => {
    setServers(next);
    saveMcpServers(next);
  }, []);

  const setConnection = useCallback(
    (id: string, status: McpConnectionStatus, message?: string) => {
      setConnections((prev) => ({ ...prev, [id]: { status, message } }));
    },
    [],
  );

  async function connectServer(server: McpServerEntry) {
    if (server.transport !== "sse" || !server.url) return;
    setConnection(server.id, "connecting");
    const result = await testMcpSseConnection(server.url);
    setConnection(server.id, result.ok ? "connected" : "error", result.message);
  }

  function disconnectServer(id: string) {
    setConnection(id, "idle");
  }

  async function connectAllEnabled() {
    for (const server of servers) {
      if (server.enabled && server.transport === "sse") {
        await connectServer(server);
      }
    }
  }

  function removeServer(id: string) {
    persist(servers.filter((s) => s.id !== id));
    setConnections((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }

  function toggleEnabled(id: string) {
    persist(servers.map((s) => (s.id === id ? { ...s, enabled: !s.enabled } : s)));
  }

  function addServer() {
    const name = draft.name?.trim();
    if (!name) return;

    const entry: McpServerEntry = {
      id: createMcpServerId(),
      name,
      transport: draft.transport ?? "sse",
      enabled: true,
      url: draft.transport === "sse" ? draft.url?.trim() || undefined : undefined,
      command: draft.transport === "stdio" ? draft.command?.trim() || undefined : undefined,
      args: draft.transport === "stdio" ? draft.args : undefined,
      env: draft.transport === "stdio" ? draft.env : undefined,
    };

    persist([...servers, entry]);
    setAdding(false);
    setDraft({
      name: "",
      transport: "sse",
      url: newSseServerDraftUrl(),
      command: "node",
      args: [],
      enabled: true,
    });
  }

  async function copyCursorConfig() {
    const merged = servers.map((s) => {
      if (isIntentServerEntry(s) && mcpEnv?.intentMcp?.stdioEnv) {
        return { ...s, env: { ...s.env, ...mcpEnv.intentMcp.stdioEnv } };
      }
      return s;
    });
    await navigator.clipboard.writeText(
      exportCursorMcpConfig(merged, mcpEnv?.stdioEnv, mcpEnv?.intentMcp?.stdioEnv),
    );
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-pocket-muted">MCP servers</p>
        <div className="flex items-center gap-3">
          {mcpEnv && (
            <span
              className={`text-xs ${mcpEnv.llmConfigured ? "text-emerald-600" : "text-amber-600"}`}
              title={mcpEnv.warnings.join(" ") || undefined}
            >
              pokt LLM: {mcpEnv.llmConfigured ? "ok" : "missing"}
            </span>
          )}
          {mcpEnv?.intentMcp && (
            <span
              className={`text-xs ${mcpEnv.intentMcp.configured ? "text-emerald-600" : "text-amber-600"}`}
              title={
                mcpEnv.intentMcp.configured
                  ? `mode: ${mcpEnv.intentMcp.mode ?? "mcp-remote"}`
                  : "Set INTENT_MCP_API_KEY in .env for remote MCP"
              }
            >
              Third-party intent-mcp:{" "}
              {mcpEnv.intentMcp.configured
                ? "ready"
                : mcpEnv.intentMcp.mode === "mcp-remote"
                  ? "set INTENT_MCP_API_KEY"
                  : "set INTENT_MCP_ARGS"}
            </span>
          )}
          <button
            type="button"
            onClick={connectAllEnabled}
            className="text-xs text-pocket-accent hover:underline"
          >
            Connect all
          </button>
        </div>
      </div>

      <ul className="space-y-2">
        {servers.map((server) => {
          const conn = connections[server.id];
          const status = conn?.status ?? "idle";
          return (
            <li
              key={server.id}
              className="rounded-lg border border-pocket-border bg-pocket-elevated/50 p-3"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <StatusDot status={server.transport === "sse" ? status : "stdio"} />
                    <span className="truncate text-sm font-medium text-pocket-foreground">
                      {server.name}
                    </span>
                    <span className="shrink-0 rounded bg-pocket-elevated px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-pocket-muted">
                      {server.transport}
                    </span>
                  </div>
                  {server.transport === "sse" && server.url && (
                    <p className="mt-1 truncate font-mono text-xs text-pocket-muted">{server.url}</p>
                  )}
                  {server.transport === "stdio" && server.command && (
                    <p className="mt-1 truncate font-mono text-xs text-pocket-muted">
                      {server.command} {formatArgsInput(server.args)}
                    </p>
                  )}
                  {conn?.message && status === "error" && (
                    <p className="mt-1 text-xs text-red-600">{conn.message}</p>
                  )}
                  {conn?.message && status === "connected" && (
                    <p className="mt-1 text-xs text-emerald-600">{conn.message}</p>
                  )}
                </div>
                <label className="flex shrink-0 items-center gap-1 text-xs text-pocket-muted">
                  <input
                    type="checkbox"
                    checked={server.enabled}
                    onChange={() => toggleEnabled(server.id)}
                    className="rounded border-pocket-border"
                  />
                  On
                </label>
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {server.transport === "sse" ? (
                  status === "connected" ? (
                    <button
                      type="button"
                      onClick={() => disconnectServer(server.id)}
                      className="rounded border border-pocket-border px-2 py-1 text-xs text-pocket-muted hover:bg-pocket-elevated"
                    >
                      Disconnect
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={!server.enabled || status === "connecting"}
                      onClick={() => connectServer(server)}
                      className="rounded bg-pocket-accent px-2 py-1 text-xs text-white disabled:opacity-50"
                    >
                      {status === "connecting" ? "Connecting…" : "Connect"}
                    </button>
                  )
                ) : (
                  <span className="text-xs text-pocket-muted">Use Cursor config export below</span>
                )}
                <button
                  type="button"
                  onClick={() => removeServer(server.id)}
                  className="rounded border border-red-200 px-2 py-1 text-xs text-red-600 hover:bg-red-50"
                >
                  Remove
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      {adding ? (
        <div className="space-y-3 rounded-lg border border-pocket-border bg-pocket-elevated/30 p-3">
          <input
            type="text"
            placeholder="Server name"
            value={draft.name ?? ""}
            onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
            className="w-full rounded-lg border border-pocket-border bg-pocket-surface px-3 py-2 text-sm"
          />
          <select
            value={draft.transport ?? "sse"}
            onChange={(e) =>
              setDraft((d) => ({ ...d, transport: e.target.value as McpTransport }))
            }
            className="w-full rounded-lg border border-pocket-border bg-pocket-surface px-3 py-2 text-sm"
          >
            <option value="sse">SSE (browser / remote)</option>
            <option value="stdio">stdio (Cursor / local)</option>
          </select>
          {draft.transport === "sse" ? (
            <input
              type="url"
              placeholder="http://127.0.0.1:3002/sse"
              value={draft.url ?? ""}
              onChange={(e) => setDraft((d) => ({ ...d, url: e.target.value }))}
              className="w-full rounded-lg border border-pocket-border bg-pocket-surface px-3 py-2 font-mono text-xs"
            />
          ) : (
            <>
              <input
                type="text"
                placeholder="Command (e.g. node)"
                value={draft.command ?? ""}
                onChange={(e) => setDraft((d) => ({ ...d, command: e.target.value }))}
                className="w-full rounded-lg border border-pocket-border bg-pocket-surface px-3 py-2 text-sm"
              />
              <input
                type="text"
                placeholder="Args (space-separated)"
                value={formatArgsInput(draft.args)}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, args: parseArgsInput(e.target.value) }))
                }
                className="w-full rounded-lg border border-pocket-border bg-pocket-surface px-3 py-2 font-mono text-xs"
              />
            </>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={addServer}
              className="rounded-lg bg-pocket-accent px-3 py-1.5 text-sm text-white"
            >
              Save server
            </button>
            <button
              type="button"
              onClick={() => setAdding(false)}
              className="rounded-lg border border-pocket-border px-3 py-1.5 text-sm text-pocket-muted"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => {
            setDraft({
              name: "",
              transport: "sse",
              url: newSseServerDraftUrl(),
              command: "node",
              args: [],
              enabled: true,
            });
            setAdding(true);
          }}
          className="w-full rounded-lg border border-dashed border-pocket-border px-3 py-2 text-sm text-pocket-muted transition-colors hover:border-pocket-accent/40 hover:text-pocket-accent"
        >
          + Add MCP server
        </button>
      )}

      <div className="space-y-2 border-t border-pocket-border pt-3">
        <button
          type="button"
          onClick={copyCursorConfig}
          className="w-full rounded-lg border border-pocket-border px-3 py-2 text-sm text-pocket-foreground transition-colors hover:bg-pocket-elevated"
        >
          {copied ? "Copied!" : "Copy Cursor MCP config (stdio servers)"}
        </button>
        <p className="text-xs text-pocket-muted">
          Web chat swap quotes use <code className="text-[11px]">INTENT_MCP_API_KEY</code> +{" "}
          <code className="text-[11px]">INTENT_MCP_REMOTE_URL</code> on the API server — the same remote MCP URL
          as below (<code className="text-[11px]">npx mcp-remote …</code>). This panel exports Cursor config; it does
          not connect chat by itself. SSE servers connect from this app when reachable from your browser.{" "}
          <a
            href="https://github.com/Endacoder/pokt-mcp/blob/main/docs/intent-mcp-agent-guide.md"
            target="_blank"
            rel="noreferrer"
            className="text-pocket-accent hover:underline"
          >
            Third-party swap guide (Metalift)
          </a>
        </p>
      </div>
    </section>
  );
}

function StatusDot({
  status,
}: {
  status: McpConnectionStatus | "stdio";
}) {
  const color =
    status === "connected"
      ? "bg-emerald-400"
      : status === "connecting"
        ? "bg-yellow-400"
        : status === "error"
          ? "bg-red-400"
          : status === "stdio"
          ? "bg-pocket-accent/60"
          : "bg-pocket-muted/40";

  return <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${color}`} aria-hidden />;
}
