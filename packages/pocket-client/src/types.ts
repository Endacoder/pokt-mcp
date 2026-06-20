export type {
  ChainInfo,
  ChainProtocol,
  RpcCall,
  RpcError,
  RpcMeta,
  RpcResponse,
  RpcResult,
} from "@pokt-mcp/shared";

export interface PocketClientOptions {
  portalBase?: string;
  fallbackRpcUrls?: Record<string, string>;
  timeoutMs?: number;
  maxRetries?: number;
  cacheTtlMs?: number;
}

export interface PocketClient {
  rpc<T>(chain: string, method: string, params?: unknown[]): Promise<import("@pokt-mcp/shared").RpcResponse<T>>;
  broadcast<T>(chain: string, rawTransaction: string): Promise<import("@pokt-mcp/shared").RpcResponse<T>>;
  batch<T>(chain: string, calls: import("@pokt-mcp/shared").RpcCall[]): Promise<import("@pokt-mcp/shared").RpcResult<T>[]>;
  getEndpoint(chain: string): string;
}

export interface ChainRegistry {
  list(): import("@pokt-mcp/shared").ChainInfo[];
  get(slug: string): import("@pokt-mcp/shared").ChainInfo | undefined;
  resolve(alias: string): import("@pokt-mcp/shared").ChainInfo | undefined;
}
