import type { McpServerEntry } from "./mcp-config";

/** Third-party MCP (Metalift) — optional swap server, not part of pokt-mcp. */

/** Third-party Intent MCP tools — reference only; not shipped or maintained by pokt-mcp. */
export const INTENT_MCP_TOOLS = [
  { name: "list_supported_chains", desc: "Discover swap networks" },
  { name: "search_token", desc: "Resolve token address + decimals (required first)" },
  { name: "get_swap_quote", desc: "Best swap price for token pair" },
  { name: "compare_quotes", desc: "Compare multiple swap routes" },
  { name: "prepare_intent", desc: "Lock quote after user confirms (userConfirmed: true)" },
  { name: "simulate_intent", desc: "Pre-flight on-chain simulation" },
  { name: "get_signing_instructions", desc: "Wallet signing steps for user" },
  { name: "submit_signed_intent", desc: "Submit after user signs in wallet" },
  { name: "get_intent_status", desc: "Poll until completed or failed" },
] as const;

export const INTENT_MCP_AGENT_GUIDE_SUMMARY = `Swap workflow: list_supported_chains → search_token → get_swap_quote → user confirms → prepare_intent(userConfirmed: true) → get_signing_instructions → submit_signed_intent → get_intent_status. Never invent token addresses. Quotes expire in 60s.`;

export const INTENT_MCP_DEFAULT_REMOTE_URL = "https://mcp.metalift.ai/mcp";

/** Shipped default — remote MCP via mcp-remote (matches intent-mcp repo). */
export const INTENT_MCP_DEFAULT_STDIO: McpServerEntry = {
  id: "intent-mcp-stdio",
  name: "intent-mcp (Cursor)",
  transport: "stdio",
  enabled: true,
  command: "npx",
  args: [
    "mcp-remote",
    INTENT_MCP_DEFAULT_REMOTE_URL,
    "--header",
    "Authorization: Bearer ${INTENT_MCP_API_KEY}",
  ],
  env: {},
};

export function defaultIntentMcpRemoteUrl(
  env: Record<string, string | undefined> = typeof process !== "undefined" ? process.env : {},
): string {
  return env.INTENT_MCP_REMOTE_URL?.trim() || INTENT_MCP_DEFAULT_REMOTE_URL;
}

export function defaultIntentMcpSseUrl(): string | undefined {
  return process.env.NEXT_PUBLIC_INTENT_MCP_SSE_URL?.trim() || undefined;
}

export function isIntentMcpConfigured(
  env: Record<string, string | undefined> = typeof process !== "undefined" ? process.env : {},
): boolean {
  return Boolean(
    env.INTENT_MCP_API_KEY?.trim() ||
      env.INTENT_MCP_ARGS?.trim() ||
      env.NEXT_PUBLIC_INTENT_MCP_SSE_URL?.trim(),
  );
}

export function isIntentMcpEnabled(
  env: Record<string, string | undefined> = typeof process !== "undefined" ? process.env : {},
): boolean {
  if (env.INTENT_MCP_ENABLED === "false" || env.INTENT_MCP_ENABLED === "0") return false;
  return true;
}

export function buildIntentMcpStdioEnv(
  env: Record<string, string | undefined> = typeof process !== "undefined" ? process.env : {},
): Record<string, string> {
  const out: Record<string, string> = {};
  if (env.INTENT_MCP_API_KEY?.trim()) out.INTENT_MCP_API_KEY = env.INTENT_MCP_API_KEY.trim();
  const apiUrl = env.INTENT_MCP_API_URL?.trim();
  if (apiUrl) out.INTENT_MCP_API_URL = apiUrl.startsWith("http") ? apiUrl : `https://${apiUrl}`;
  if (env.WALLETCONNECT_PROJECT_ID) out.WALLETCONNECT_PROJECT_ID = env.WALLETCONNECT_PROJECT_ID;
  return out;
}

function buildRemoteIntentEntry(
  env: Record<string, string | undefined>,
): McpServerEntry {
  const remoteUrl = defaultIntentMcpRemoteUrl(env);
  return {
    id: "intent-mcp-stdio",
    name: "intent-mcp (Cursor)",
    transport: "stdio",
    enabled: true,
    command: "npx",
    args: [
      "mcp-remote",
      remoteUrl,
      "--header",
      "Authorization: Bearer ${INTENT_MCP_API_KEY}",
    ],
    env: buildIntentMcpStdioEnv(env),
  };
}

/** Runtime entry from env — always returns a template (remote by default). */
export function buildIntentMcpServerEntry(
  env: Record<string, string | undefined> = typeof process !== "undefined" ? process.env : {},
): McpServerEntry {
  if (!isIntentMcpEnabled(env)) {
    return { ...INTENT_MCP_DEFAULT_STDIO, enabled: false };
  }

  const sseUrl = env.NEXT_PUBLIC_INTENT_MCP_SSE_URL?.trim();
  if (sseUrl) {
    return {
      id: "intent-mcp-sse",
      name: "intent-mcp",
      transport: "sse",
      enabled: true,
      url: sseUrl,
    };
  }

  const argsRaw = env.INTENT_MCP_ARGS?.trim();
  if (argsRaw) {
    const command = env.INTENT_MCP_COMMAND?.trim() || "node";
    return {
      id: "intent-mcp-stdio",
      name: "intent-mcp (Cursor)",
      transport: "stdio",
      enabled: true,
      command,
      args: argsRaw.split(/\s+/).filter(Boolean),
      env: buildIntentMcpStdioEnv(env),
    };
  }

  return buildRemoteIntentEntry(env);
}

export function isIntentServerEntry(server: McpServerEntry): boolean {
  return server.id.startsWith("intent-mcp") || /intent-mcp/i.test(server.name);
}
