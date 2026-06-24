export type ChainProtocol = "evm" | "solana" | "cosmos" | "sui" | "near" | "tron";
export type ChainStatus = "active" | "degraded" | "inactive";
export type RiskLevel = "none" | "low" | "high";
export type RpcAction = "read" | "write";
export type ConnectionType = "walletconnect" | "injected" | "local" | "none";

/** User-selected swap routing passed to Intent MCP quote tools. */
export type SwapExecutionMode = "any" | "gasless";

/** Execution mode returned on a quote from Intent MCP. */
export type QuoteExecutionMode = "any" | "gasless" | "gas";

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
  /** Pocket portal subdomain when it differs from `slug` (e.g. Optimism uses `op`). */
  portalSlug?: string;
  aliases: string[];
  blockExplorer?: string;
  testnet?: boolean;
  network?: "mainnet" | "testnet";
  status?: ChainStatus;
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
  truncated?: boolean;
  warning?: string;
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

export interface WalletPortfolioChain {
  chain: string;
  chainName: string;
  nativeSymbol: string;
  nativeBalance: string;
  tokens: Array<{ symbol: string; balance: string }>;
}

/** Snapshot from the last wallet balance query (single- or multi-chain). */
export interface WalletPortfolioSnapshot {
  address: string;
  chains: WalletPortfolioChain[];
  scanned?: number;
}

export interface SessionContext {
  defaultChain?: string;
  connectedAddress?: string;
  /** Intent MCP swap quote routing — gasless (CoW) or gas (Uniswap). */
  swapExecutionMode?: SwapExecutionMode;
  lastBalance?: {
    chain: string;
    address: string;
    wei: string;
  };
  /** Full wallet holdings for convert follow-ups ("what's that in USD?"). */
  lastWalletPortfolio?: WalletPortfolioSnapshot;
  /** Last metric query for time-based follow-ups ("what was it 1 hour ago"). */
  lastQuery?: {
    chain: string;
    method: string;
    subject: "gas" | "balance" | "blockNumber";
    params?: unknown[];
  };
  /** Last submitted swap intent for status follow-ups ("did that swap succeed?"). */
  lastSwapIntent?: LastSwapIntent;
  /** Last submitted native transfer for status follow-ups ("did that send succeed?"). */
  lastSendTx?: LastSendTransaction;
  /** Last spot price or price-change query for market follow-ups ("how about in a week?"). */
  lastMarketQuery?: {
    symbol: string;
    coingeckoId: string;
    kind: "priceChange" | "spotPrice";
    period?: "24h" | "7d" | "14d" | "30d" | "1y";
  };
  /** Last ERC-20 transfer log query for follow-ups ("I've received tokens", "check balance"). */
  lastTransferQuery?: LastTransferQuery;
}

export interface LastTransferQuery {
  chain: string;
  tokenSymbol: string;
  walletAddress: string;
  blockRange: number;
  hadEmptyResult?: boolean;
}

/** Prior chat turn sent with each request for conversational context. */
export interface ChatHistoryMessage {
  role: "user" | "assistant";
  content: string;
}

/** Optional hooks while streaming from an LLM (reasoning models). */
export interface LlmStreamCallbacks {
  onReasoning?: (chunk: string) => void;
}

export interface LastSendTransaction {
  txHash: string;
  chain: string;
  chainName?: string;
  to?: string;
  valueNative?: string;
  nativeSymbol?: string;
  submittedAt?: string;
  status?: "submitted" | "pending" | "success" | "reverted";
  explorerUrl?: string;
}

export interface LastSwapIntent {
  intentId: string;
  txHash?: string;
  status?: string;
  submittedAt?: string;
  amountIn?: string;
  tokenIn?: string;
  tokenOut?: string;
  chainName?: string;
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
  sessionId: string;
  /** Prior conversation turns for follow-up context (client sends, not persisted server-side). */
  history?: ChatHistoryMessage[];
  /** Injected by API from wallet session when available */
  connectedAddress?: string;
  /** Swap quote routing preference from web UI */
  swapExecutionMode?: SwapExecutionMode;
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
  gasLimit?: string;
}

export interface WalletTxBroadcastRequest {
  chain: string;
  rawTransaction: string;
}
