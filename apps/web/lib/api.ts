import { clearSessionToken, ensureSessionToken, sessionHeaders } from "./session";

async function apiFetch(apiUrl: string, path: string, init: RequestInit = {}): Promise<Response> {
  await ensureSessionToken(apiUrl);
  const run = () =>
    fetch(`${apiUrl}${path}`, {
      ...init,
      headers: sessionHeaders(init.headers as Record<string, string> | undefined),
    });

  let res = await run();
  if (res.status === 401) {
    clearSessionToken();
    await ensureSessionToken(apiUrl, true);
    res = await run();
  }
  return res;
}

import type { ChatHistoryMessage } from "@pokt-mcp/shared";

export type ChainInfo = {
  slug: string;
  name: string;
  chainId?: number;
  nativeSymbol?: string;
};

export type ChatRequest = {
  message: string;
  chain?: string;
  sessionId: string;
  history?: ChatHistoryMessage[];
  connectedAddress?: string;
  swapExecutionMode?: "any" | "gasless";
};

export type AgentEventType = "token" | "reasoning" | "tool" | "status" | "result" | "error" | "done";

export type ParsedSseEvent = {
  event: AgentEventType;
  data: unknown;
};

export async function fetchChains(apiUrl: string): Promise<ChainInfo[]> {
  const res = await apiFetch(apiUrl, "/chains");
  if (!res.ok) throw new Error("Failed to load chains");
  const json = (await res.json()) as { chains: ChainInfo[] };
  return json.chains.filter((c) => c.chainId !== undefined);
}

/** Buffer SSE stream lines and emit parsed events. */
export async function* parseChatSse(response: Response): AsyncGenerator<ParsedSseEvent> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("No response body");

  const decoder = new TextDecoder();
  let buffer = "";
  let currentEvent: AgentEventType = "token";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (line.startsWith("event:")) {
        currentEvent = line.slice(6).trim() as AgentEventType;
        continue;
      }
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload) continue;
      try {
        yield { event: currentEvent, data: JSON.parse(payload) };
      } catch {
        // skip malformed partial JSON
      }
    }
  }

  if (buffer.trim()) {
    for (const line of buffer.split("\n")) {
      if (line.startsWith("event:")) {
        currentEvent = line.slice(6).trim() as AgentEventType;
      } else if (line.startsWith("data:")) {
        const payload = line.slice(5).trim();
        if (payload) {
          try {
            yield { event: currentEvent, data: JSON.parse(payload) };
          } catch {
            // ignore
          }
        }
      }
    }
  }
}

export type RpcRequest = {
  chain: string;
  method: string;
  params?: unknown[];
};

export async function postChat(
  apiUrl: string,
  body: ChatRequest,
  options?: { signal?: AbortSignal },
): Promise<Response> {
  return apiFetch(apiUrl, "/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: options?.signal,
  });
}

export async function postRpc(
  apiUrl: string,
  body: RpcRequest,
): Promise<{ result?: unknown; meta?: unknown; error?: string }> {
  const res = await apiFetch(apiUrl, "/rpc", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as { result?: unknown; meta?: unknown; error?: string };
  if (!res.ok) throw new Error(json.error ?? `RPC failed: ${res.status}`);
  return json;
}

export type TxPreviewResponse = {
  summary: string;
  transaction: {
    from?: string;
    to: string;
    value?: string;
    data?: string;
    gas?: string;
    maxFeePerGas?: string;
    maxPriorityFeePerGas?: string;
    nonce?: number;
    chainId?: number;
  };
  estimatedGas?: string;
  gasEstimateFallback?: boolean;
  explorerUrl?: string;
  error?: string;
};

export async function previewTransaction(
  apiUrl: string,
  body: { chain: string; from: string; to: string; value?: string; data?: string; gasLimit?: string },
): Promise<TxPreviewResponse> {
  const res = await apiFetch(apiUrl, "/wallet/tx/preview", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return (await res.json()) as TxPreviewResponse;
}

export async function broadcastTransaction(
  apiUrl: string,
  body: { chain: string; rawTransaction: string },
): Promise<{ txHash: string; explorerUrl?: string; status?: string }> {
  const res = await apiFetch(apiUrl, "/wallet/tx/broadcast", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as { txHash?: string; explorerUrl?: string; status?: string; error?: string };
  if (!res.ok || !json.txHash) {
    throw new Error(json.error ?? `Broadcast failed (${res.status})`);
  }
  return { txHash: json.txHash, explorerUrl: json.explorerUrl, status: json.status };
}

export async function recordSubmittedTransaction(
  apiUrl: string,
  body: {
    txHash: string;
    chain: string;
    to?: string;
    valueNative?: string;
    nativeSymbol?: string;
    explorerUrl?: string;
  },
): Promise<void> {
  const res = await apiFetch(apiUrl, "/wallet/tx/record", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const json = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(json.error ?? `Failed to record transaction (${res.status})`);
  }
}

export async function verifySubmittedTransaction(
  apiUrl: string,
  body: { chain: string; txHash: string; timeoutMs?: number },
): Promise<{ found: boolean; pending: boolean; waitedMs: number; chainName?: string }> {
  const res = await apiFetch(apiUrl, "/wallet/tx/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as {
    found?: boolean;
    pending?: boolean;
    waitedMs?: number;
    chainName?: string;
    error?: string;
  };
  if (!res.ok) {
    throw new Error(json.error ?? `Verify failed (${res.status})`);
  }
  return {
    found: Boolean(json.found),
    pending: Boolean(json.pending),
    waitedMs: json.waitedMs ?? 0,
    chainName: json.chainName,
  };
}

export type McpEnvStatus = {
  llmConfigured: boolean;
  featureNlLlm?: boolean;
  agentLoopEnabled: boolean;
  agentMaxSteps?: number;
  warnings: string[];
  stdioEnv?: Record<string, string>;
  intentMcp?: {
    enabled: boolean;
    configured: boolean;
    mode?: "mcp-remote" | "stdio-local" | "sse";
    stdioEnv?: Record<string, string>;
    hasApiKey?: boolean;
    hasCommand?: boolean;
    hasSseUrl?: boolean;
    remoteUrl?: string;
    serverEntry?: Record<string, unknown>;
  };
};

/** Server-side MCP env status (Next.js route — requires session token when enabled). */
export async function fetchMcpEnv(apiUrl: string): Promise<McpEnvStatus | null> {
  await ensureSessionToken(apiUrl);
  const run = () =>
    fetch("/api/mcp-env", {
      headers: sessionHeaders(),
    });

  let res = await run();
  if (res.status === 401) {
    clearSessionToken();
    await ensureSessionToken(apiUrl, true);
    res = await run();
  }
  if (!res.ok) return null;
  return res.json() as Promise<McpEnvStatus>;
}
