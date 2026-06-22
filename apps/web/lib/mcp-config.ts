import { defaultMcpSseUrl, isLocalOnlyUrl, isSseUrlAllowedInBrowser } from "./api-url";
import {
  buildIntentMcpServerEntry,
  INTENT_MCP_DEFAULT_STDIO,
  isIntentServerEntry,
} from "./intent-mcp-config";

export type McpTransport = "sse" | "stdio";

export type McpServerEntry = {
  id: string;
  name: string;
  transport: McpTransport;
  enabled: boolean;
  /** SSE endpoint, e.g. http://127.0.0.1:3002/sse (local dev only) */
  url?: string;
  /** stdio command (Cursor / local MCP clients) */
  command?: string;
  args?: string[];
  env?: Record<string, string>;
};

export type McpConnectionStatus = "idle" | "connecting" | "connected" | "error";

const STORAGE_KEY = "pokt-mcp-mcp-servers";

/** Build stdio env for Cursor MCP — server-side reads process.env for LLM keys. */
export function buildMcpStdioEnv(
  env: Record<string, string | undefined> = typeof process !== "undefined" ? process.env : {},
): Record<string, string> {
  const base: Record<string, string> = {
    POCKET_DEFAULT_CHAIN: env.POCKET_DEFAULT_CHAIN ?? "eth",
    REQUIRE_CONFIRMATION: env.REQUIRE_CONFIRMATION ?? "true",
    ALLOW_LOCAL_SIGNER: env.ALLOW_LOCAL_SIGNER ?? "false",
    MAX_SEND_VALUE_ETH: env.MAX_SEND_VALUE_ETH ?? "1.0",
    WALLET_ALLOWED_CHAINS: env.WALLET_ALLOWED_CHAINS ?? "eth,base,arb-one,poly,opt,avax",
    RPC_METHOD_DENYLIST: env.RPC_METHOD_DENYLIST ?? "personal_importRawKey,eth_sign",
    FEATURE_NL_LLM: env.FEATURE_NL_LLM ?? "true",
    FEATURE_AGENT_LOOP: env.FEATURE_AGENT_LOOP ?? "false",
    FEATURE_THINKING: env.FEATURE_THINKING ?? "false",
    AGENT_MAX_STEPS: env.AGENT_MAX_STEPS ?? "8",
    LLM_PROVIDER: env.LLM_PROVIDER ?? "litellm",
  };

  if (env.LLM_MODEL) base.LLM_MODEL = env.LLM_MODEL;
  if (env.LITELLM_MODEL && !env.LLM_MODEL) base.LLM_MODEL = env.LITELLM_MODEL;
  if (env.LITELLM_BASE_URL) base.LITELLM_BASE_URL = env.LITELLM_BASE_URL;
  if (env.LITELLM_API_KEY) base.LITELLM_API_KEY = env.LITELLM_API_KEY;
  if (env.OPENAI_API_KEY) base.OPENAI_API_KEY = env.OPENAI_API_KEY;
  if (env.OPENAI_BASE_URL) base.OPENAI_BASE_URL = env.OPENAI_BASE_URL;

  return base;
}

function buildDefaultMcpServers(): McpServerEntry[] {
  const servers: McpServerEntry[] = [];
  const sseUrl = defaultMcpSseUrl();
  if (sseUrl) {
    servers.push({
      id: "pokt-mcp-sse",
      name: "pokt-mcp",
      transport: "sse",
      enabled: true,
      url: sseUrl,
    });
  }
  servers.push({
    id: "pokt-mcp-stdio",
    name: "pokt-mcp (Cursor)",
    transport: "stdio",
    enabled: true,
    command: "node",
    args: ["packages/mcp-server/dist/index.js"],
    env: buildMcpStdioEnv(),
  });

  const intentServer = buildIntentMcpServerEntry();
  servers.push(intentServer);

  return servers;
}

/** Add any built-in servers missing from saved localStorage (e.g. intent-mcp after upgrade). */
export function mergeDefaultMcpServers(stored: McpServerEntry[]): McpServerEntry[] {
  const defaults = buildDefaultMcpServers();
  const result = [...stored];

  for (const def of defaults) {
    const hasMatch = result.some(
      (s) => s.id === def.id || (isIntentServerEntry(def) && isIntentServerEntry(s)),
    );
    if (!hasMatch) {
      result.push(def);
    }
  }

  return result;
}

function sanitizeServersForBrowser(servers: McpServerEntry[]): McpServerEntry[] {
  return servers.map((server) => {
    if (server.transport === "sse" && server.url && !isSseUrlAllowedInBrowser(server.url)) {
      return { ...server, enabled: false };
    }
    return server;
  });
}

export const DEFAULT_MCP_SERVERS: McpServerEntry[] = buildDefaultMcpServers();

export function loadMcpServers(): McpServerEntry[] {
  if (typeof window === "undefined") return DEFAULT_MCP_SERVERS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return sanitizeServersForBrowser(DEFAULT_MCP_SERVERS);
    const parsed = JSON.parse(raw) as McpServerEntry[];
    const servers = parsed.length ? mergeDefaultMcpServers(parsed) : DEFAULT_MCP_SERVERS;
    return sanitizeServersForBrowser(servers);
  } catch {
    return sanitizeServersForBrowser(DEFAULT_MCP_SERVERS);
  }
}

/** Load from localStorage, merge missing defaults, persist when upgraded. */
export function loadAndPersistMcpServers(): McpServerEntry[] {
  if (typeof window === "undefined") return DEFAULT_MCP_SERVERS;
  const raw = localStorage.getItem(STORAGE_KEY);
  let stored: McpServerEntry[] = [];
  try {
    if (raw) stored = JSON.parse(raw) as McpServerEntry[];
  } catch {
    stored = [];
  }

  const merged = stored.length ? mergeDefaultMcpServers(stored) : DEFAULT_MCP_SERVERS;
  const sanitized = sanitizeServersForBrowser(merged);

  const changed =
    !raw ||
    merged.length !== stored.length ||
    merged.some((s) => !stored.some((x) => x.id === s.id));

  if (changed) saveMcpServers(sanitized);
  return sanitized;
}

export function saveMcpServers(servers: McpServerEntry[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(servers));
}

export function createMcpServerId(): string {
  return `mcp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function sseBaseUrl(url: string): string {
  return url.replace(/\/sse\/?$/, "").replace(/\/$/, "");
}

export async function testMcpSseConnection(
  sseUrl: string,
): Promise<{ ok: boolean; message: string }> {
  if (!isSseUrlAllowedInBrowser(sseUrl)) {
    return {
      ok: false,
      message: isLocalOnlyUrl(sseUrl)
        ? "Localhost/LAN MCP URLs cannot be reached from this site. Use Cursor stdio config or open the app locally."
        : "Invalid MCP SSE URL for this browser context.",
    };
  }

  const base = sseBaseUrl(sseUrl);
  try {
    const res = await fetch(base, { signal: AbortSignal.timeout(5000) });
    const text = await res.text();
    if (res.ok && /mcp|sse/i.test(text)) {
      return { ok: true, message: "Connected" };
    }
    return { ok: false, message: `Unexpected response (${res.status})` };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

export function exportCursorMcpConfig(
  servers: McpServerEntry[],
  poktStdioEnvOverride?: Record<string, string>,
  intentStdioEnvOverride?: Record<string, string>,
): string {
  const mcpServers: Record<string, { command: string; args?: string[]; env?: Record<string, string> }> =
    {};

  for (const server of servers) {
    if (!server.enabled || server.transport !== "stdio" || !server.command) continue;
    const isPokt = server.id.startsWith("pokt-mcp");
    const isIntent = isIntentServerEntry(server);
    const env = {
      ...server.env,
      ...(isPokt && poktStdioEnvOverride ? poktStdioEnvOverride : {}),
      ...(isIntent && intentStdioEnvOverride ? intentStdioEnvOverride : {}),
    };
    const exportName = isIntent ? "intent-mcp" : server.name.replace(/\s+\(Cursor\)$/, "");
    mcpServers[exportName] = {
      command: server.command,
      ...(server.args?.length ? { args: server.args } : {}),
      ...(Object.keys(env).length ? { env } : {}),
    };
  }

  return JSON.stringify({ mcpServers }, null, 2);
}

export function parseArgsInput(value: string): string[] {
  return value
    .split(/\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function formatArgsInput(args?: string[]): string {
  return args?.join(" ") ?? "";
}

export function newSseServerDraftUrl(): string {
  return defaultMcpSseUrl() || "";
}
