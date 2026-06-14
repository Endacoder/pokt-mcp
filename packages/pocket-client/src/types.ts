export type ChainProtocol = "evm" | "solana" | "cosmos";

export interface ChainInfo {
  slug: string;
  name: string;
  chainId?: number;
  nativeSymbol: string;
  protocol: ChainProtocol;
  endpoint: string;
  aliases: string[];
  blockExplorer?: string;
}

export interface RpcCall {
  method: string;
  params?: unknown[];
}

export interface RpcResult<T = unknown> {
  id: number | string;
  result?: T;
  error?: RpcError;
}

export interface RpcError {
  code: number;
  message: string;
  data?: unknown;
}

export interface RpcMeta {
  chain: string;
  method: string;
  latencyMs: number;
  endpoint: string;
}

export interface RpcResponse<T = unknown> {
  result: T;
  meta: RpcMeta;
}

export interface PocketClientOptions {
  portalBase?: string;
  fallbackRpcUrls?: Record<string, string>;
  timeoutMs?: number;
  maxRetries?: number;
}

export interface PocketClient {
  rpc<T>(chain: string, method: string, params?: unknown[]): Promise<RpcResponse<T>>;
  broadcast<T>(chain: string, rawTransaction: string): Promise<RpcResponse<T>>;
  batch<T>(chain: string, calls: RpcCall[]): Promise<RpcResult<T>[]>;
  getEndpoint(chain: string): string;
}

export interface ChainRegistry {
  list(): ChainInfo[];
  get(slug: string): ChainInfo | undefined;
  resolve(alias: string): ChainInfo | undefined;
}
