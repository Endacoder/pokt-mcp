export const DEFAULT_INTENT_MCP_REMOTE_URL = "https://mcp.metalift.ai/mcp";

const DEFAULT_LOCAL_INTENT_API_URL = "http://127.0.0.1:3101";

export type IntentMcpTransport = "rest" | "mcp-remote";

export interface IntentMcpConfig {
  enabled: boolean;
  apiKey: string;
  transport: IntentMcpTransport;
  /** Intent API REST base when transport is `rest`. */
  apiUrl: string;
  /** Remote MCP HTTP endpoint (same URL as `npx mcp-remote …`) when transport is `mcp-remote`. */
  mcpUrl: string;
}

function normalizeUrl(raw: string): string {
  return raw.startsWith("http") ? raw : `https://${raw}`;
}

export function isMcpHttpEndpoint(url: string): boolean {
  const normalized = url.replace(/\/+$/, "").toLowerCase();
  return normalized.endsWith("/mcp") || normalized.includes("mcp.metalift.ai");
}

export function loadIntentMcpApiUrl(
  env: Record<string, string | undefined> = typeof process !== "undefined" ? process.env : {},
): string {
  const raw = env.INTENT_MCP_API_URL?.trim();
  if (raw) return normalizeUrl(raw);
  return DEFAULT_LOCAL_INTENT_API_URL;
}

export function loadIntentMcpRemoteUrl(
  env: Record<string, string | undefined> = typeof process !== "undefined" ? process.env : {},
): string {
  const raw = env.INTENT_MCP_REMOTE_URL?.trim();
  return raw ? normalizeUrl(raw) : DEFAULT_INTENT_MCP_REMOTE_URL;
}

export function isIntentMcpEnabled(
  env: Record<string, string | undefined> = typeof process !== "undefined" ? process.env : {},
): boolean {
  if (env.INTENT_MCP_ENABLED === "false" || env.INTENT_MCP_ENABLED === "0") return false;
  return true;
}

export function loadIntentMcpConfig(
  env: Record<string, string | undefined> = typeof process !== "undefined" ? process.env : {},
): IntentMcpConfig | null {
  if (!isIntentMcpEnabled(env)) return null;
  const apiKey = env.INTENT_MCP_API_KEY?.trim();
  if (!apiKey) return null;

  const mcpUrlDefault = loadIntentMcpRemoteUrl(env);
  const apiUrlRaw = env.INTENT_MCP_API_URL?.trim();

  if (apiUrlRaw && !isMcpHttpEndpoint(apiUrlRaw)) {
    return {
      enabled: true,
      apiKey,
      transport: "rest",
      apiUrl: normalizeUrl(apiUrlRaw),
      mcpUrl: mcpUrlDefault,
    };
  }

  const mcpUrl =
    apiUrlRaw && isMcpHttpEndpoint(apiUrlRaw) ? normalizeUrl(apiUrlRaw) : mcpUrlDefault;

  return {
    enabled: true,
    apiKey,
    transport: "mcp-remote",
    mcpUrl,
    apiUrl: loadIntentMcpApiUrl(env),
  };
}

export class IntentApiClient {
  constructor(private readonly config: Pick<IntentMcpConfig, "apiKey" | "apiUrl">) {}

  private headers(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.config.apiKey}`,
    };
  }

  async get<T>(path: string): Promise<T> {
    const response = await fetch(`${this.config.apiUrl}${path}`, { headers: this.headers() });
    const data = await response.json();
    if (!response.ok) {
      throw new Error((data as { error?: string }).error ?? `HTTP ${response.status}`);
    }
    return data as T;
  }

  async post<T>(path: string, body: unknown): Promise<T> {
    const response = await fetch(`${this.config.apiUrl}${path}`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error((data as { error?: string }).error ?? `HTTP ${response.status}`);
    }
    return data as T;
  }
}
