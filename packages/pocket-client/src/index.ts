import { resolveChain } from "./registry/index.js";
import type {
  ChainRegistry,
  PocketClient,
  PocketClientOptions,
  RpcCall,
  RpcResponse,
  RpcResult,
} from "./types.js";

const DEFAULT_DENYLIST = [
  "personal_importRawKey",
  "eth_sign",
];

function getDenylist(): Set<string> {
  const env = process.env.RPC_METHOD_DENYLIST ?? "";
  const methods = env.split(",").map((m) => m.trim()).filter(Boolean);
  return new Set([...DEFAULT_DENYLIST, ...methods]);
}

function isWriteMethod(method: string): boolean {
  return (
    method === "eth_sendRawTransaction" ||
    method === "eth_sendTransaction" ||
    method.startsWith("personal_")
  );
}

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

import { getChain, listChains } from "./registry/index.js";

export function createChainRegistry(): ChainRegistry {
  return { list: listChains, get: getChain, resolve: resolveChain };
}

export function createPocketClient(options: PocketClientOptions = {}): PocketClient {
  const timeoutMs = options.timeoutMs ?? 30_000;
  const maxRetries = options.maxRetries ?? 3;
  const cacheTtlMs = options.cacheTtlMs ?? 5_000;
  const fallback = options.fallbackRpcUrls ?? parseFallbackEnv();
  const cache = new Map<string, { expires: number; value: RpcResponse<unknown> }>();
  const CACHEABLE = new Set(["eth_blockNumber", "eth_gasPrice", "eth_chainId"]);

  function cacheKey(chain: string, method: string, params: unknown[]) {
    return `${chain}:${method}:${JSON.stringify(params)}`;
  }

  function resolveEndpoint(chain: string): string {
    const info = resolveChain(chain);
    if (!info) {
      throw new Error(`CHAIN_NOT_FOUND: unknown chain "${chain}"`);
    }
    return fallback[info.slug] ?? info.endpoint;
  }

  async function post<T>(
    endpoint: string,
    body: unknown,
    chain: string,
    method: string,
  ): Promise<RpcResponse<T>> {
    const denylist = getDenylist();
    if (typeof body === "object" && body !== null && "method" in body) {
      const m = (body as { method: string }).method;
      if (denylist.has(m)) {
        throw new Error(`POLICY_DENIED: method "${m}" is not allowed`);
      }
    }

    const start = Date.now();
    let lastError: Error | undefined;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);

        const res = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
        clearTimeout(timer);

        if (res.status === 429 || res.status >= 500) {
          throw new Error(`HTTP ${res.status}: ${await res.text()}`);
        }

        const json = (await res.json()) as RpcResult<T> | RpcResult<T>[];

        if (Array.isArray(json)) {
          return {
            result: json as unknown as T,
            meta: {
              chain,
              method: "batch",
              latencyMs: Date.now() - start,
              endpoint,
            },
          };
        }

        if (json.error) {
          throw new Error(`RPC_ERROR ${json.error.code}: ${json.error.message}`);
        }

        return {
          result: json.result as T,
          meta: {
            chain,
            method,
            latencyMs: Date.now() - start,
            endpoint,
          },
        };
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (attempt < maxRetries - 1) {
          await sleep(2 ** attempt * 500);
        }
      }
    }

    throw lastError ?? new Error("RPC_ERROR: request failed");
  }

  return {
    getEndpoint(chain: string) {
      return resolveEndpoint(chain);
    },

    async rpc<T>(chain: string, method: string, params: unknown[] = []) {
      if (getDenylist().has(method)) {
        throw new Error(`POLICY_DENIED: method "${method}" is not allowed`);
      }
      if (isWriteMethod(method)) {
        throw new Error(
          `POLICY_DENIED: use wallet_send_transaction for "${method}" instead of direct RPC`,
        );
      }

      const key = cacheKey(chain, method, params);
      if (CACHEABLE.has(method)) {
        const hit = cache.get(key);
        if (hit && hit.expires > Date.now()) {
          return hit.value as RpcResponse<T>;
        }
      }

      const endpoint = resolveEndpoint(chain);
      const body = { jsonrpc: "2.0", method, params, id: 1 };
      const resp = await post<T>(endpoint, body, chain, method);

      if (CACHEABLE.has(method)) {
        cache.set(key, { expires: Date.now() + cacheTtlMs, value: resp as RpcResponse<unknown> });
      }

      return resp;
    },

    async broadcast<T>(chain: string, rawTransaction: string) {
      const endpoint = resolveEndpoint(chain);
      const body = {
        jsonrpc: "2.0",
        method: "eth_sendRawTransaction",
        params: [rawTransaction],
        id: 1,
      };
      return post<T>(endpoint, body, chain, "eth_sendRawTransaction");
    },

    async batch<T>(chain: string, calls: RpcCall[]) {
      for (const call of calls) {
        if (getDenylist().has(call.method)) {
          throw new Error(`POLICY_DENIED: method "${call.method}" is not allowed`);
        }
        if (isWriteMethod(call.method)) {
          throw new Error(`POLICY_DENIED: write methods not allowed in batch`);
        }
      }

      const endpoint = resolveEndpoint(chain);
      const body = calls.map((call, i) => ({
        jsonrpc: "2.0",
        method: call.method,
        params: call.params ?? [],
        id: i + 1,
      }));

      return post<T[]>(endpoint, body, chain, "batch").then((r) => r.result as RpcResult<T>[]);
    },
  };
}

function parseFallbackEnv(): Record<string, string> {
  const raw = process.env.FALLBACK_RPC_URLS ?? "";
  const out: Record<string, string> = {};
  for (const part of raw.split(",")) {
    const [slug, url] = part.split("=").map((s) => s.trim());
    if (slug && url) out[slug] = url;
  }
  return out;
}

export * from "./types.js";
export { listChains, getChain, resolveChain } from "./registry/index.js";
