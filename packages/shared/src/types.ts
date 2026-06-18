export type ChainProtocol = "evm" | "solana" | "cosmos";
export type RiskLevel = "none" | "low" | "high";
export type RpcAction = "read" | "write";
export type ConnectionType = "walletconnect" | "injected" | "local" | "none";

export type PoktErrorCode =
  | "CHAIN_NOT_FOUND"
  | "RPC_ERROR"
  | "POLICY_DENIED"
  | "WALLET_NOT_CONNECTED"
  | "USER_REJECTED"
  | "NL_PARSE_FAILED";

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

export interface RpcIntent {
  action: RpcAction;
  chain: string;
  method: string;
  params: unknown[];
  humanSummary: string;
  riskLevel: RiskLevel;
}

export interface SessionContext {
  defaultChain?: string;
  connectedAddress?: string;
}

export interface NlParseResult {
  intent: RpcIntent;
  pendingAction?: "wallet_send_transaction" | "wallet_sign_message";
  requiresConfirmation: boolean;
}

export interface WalletStatus {
  connected: boolean;
  address?: string;
  chainId?: number;
  chainSlug?: string;
  connectionType: ConnectionType;
}

export interface UnsignedTransaction {
  chain: string;
  from?: string;
  to: string;
  value?: string;
  data?: string;
  gas?: string;
  gasPrice?: string;
  maxFeePerGas?: string;
  maxPriorityFeePerGas?: string;
  nonce?: number;
  chainId?: number;
}

export interface ConnectResult {
  uri?: string;
  connected: boolean;
  address?: string;
}

export interface TxPreview {
  summary: string;
  transaction: UnsignedTransaction;
  estimatedGas?: string;
  explorerUrl?: string;
}

export interface SendResult {
  txHash: string;
  status: "submitted" | "rejected" | "pending";
  explorerUrl?: string;
}

export interface PoktError {
  code: PoktErrorCode;
  message: string;
  details?: unknown;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  toolCalls?: ToolCallResult[];
}

export interface ToolCallResult {
  tool: string;
  input: unknown;
  output: unknown;
  latencyMs?: number;
}

export interface ChatRequest {
  message: string;
  chain?: string;
  sessionId?: string;
}

export interface RpcRequest {
  chain: string;
  method: string;
  params?: unknown[];
}

export interface WalletTxPreviewRequest {
  chain: string;
  from: string;
  to: string;
  value?: string;
  data?: string;
}

export interface WalletTxBroadcastRequest {
  chain: string;
  rawTransaction: string;
}
