import type { ChatHistoryMessage, RpcIntent, SessionContext } from "./types.js";

/** Matches labeled private keys (not bare tx hashes). */
const PRIVATE_KEY_LABEL_RE =
  /(?:private\s+key|secret\s+key|privkey|wallet\s+secret)\s*[:=]?\s*(?:0x)?[a-fA-F0-9]{64}/gi;

/** Rough BIP-39 phrase detector (12–24 lowercase words). */
const MNEMONIC_RE = /\b(?:[a-z]{3,8}\s+){11,23}[a-z]{3,8}\b/gi;

const DEFAULT_MAX_HISTORY_MESSAGES = 20;
const DEFAULT_MAX_HISTORY_CONTENT = 800;

function redactSecrets(text: string): string {
  return text.replace(PRIVATE_KEY_LABEL_RE, "[REDACTED_KEY]").replace(MNEMONIC_RE, "[REDACTED_SEED]");
}

/** Strip secrets from free-text query before LLM or MCP handling. */
export function sanitizeQueryText(query: string): string {
  return redactSecrets(query.trim());
}

/** Cap, truncate, and redact chat history before LLM context. */
export function sanitizeChatHistory(
  history?: ChatHistoryMessage[],
  maxMessages = DEFAULT_MAX_HISTORY_MESSAGES,
  maxContent = DEFAULT_MAX_HISTORY_CONTENT,
): ChatHistoryMessage[] {
  if (!history?.length) return [];
  const capped = history.length > maxMessages ? history.slice(-maxMessages) : history;
  return capped.map((msg) => {
    const content = redactSecrets(msg.content.trim());
    if (content.length <= maxContent) return { role: msg.role, content };
    return { role: msg.role, content: `${content.slice(0, maxContent)}…` };
  });
}

/** Whitelist session fields safe to include in LLM prompts. */
export function sanitizeSessionContextForLlm(context?: SessionContext): SessionContext | undefined {
  if (!context) return undefined;
  const sanitized: SessionContext = {};
  if (context.defaultChain) sanitized.defaultChain = context.defaultChain;
  if (context.connectedAddress) sanitized.connectedAddress = context.connectedAddress;
  if (context.swapExecutionMode) sanitized.swapExecutionMode = context.swapExecutionMode;
  if (context.lastBalance) sanitized.lastBalance = { ...context.lastBalance };
  if (context.lastWalletPortfolio) sanitized.lastWalletPortfolio = { ...context.lastWalletPortfolio };
  if (context.lastQuery) sanitized.lastQuery = { ...context.lastQuery };
  if (context.lastMarketQuery) sanitized.lastMarketQuery = { ...context.lastMarketQuery };
  if (context.lastTransferQuery) sanitized.lastTransferQuery = { ...context.lastTransferQuery };
  if (context.lastSendTx) sanitized.lastSendTx = { ...context.lastSendTx };
  if (context.lastSwapIntent) {
    sanitized.lastSwapIntent = {
      intentId: context.lastSwapIntent.intentId,
      status: context.lastSwapIntent.status,
      tokenIn: context.lastSwapIntent.tokenIn,
      tokenOut: context.lastSwapIntent.tokenOut,
      amountIn: context.lastSwapIntent.amountIn,
      chainName: context.lastSwapIntent.chainName,
      txHash: context.lastSwapIntent.txHash,
      submittedAt: context.lastSwapIntent.submittedAt,
    };
  }
  return sanitized;
}

/** Normalize LLM-produced intent before MCP / RPC execution. */
export function sanitizeIntentForMcp(intent: RpcIntent): RpcIntent {
  return {
    ...intent,
    chain: intent.chain.trim().toLowerCase(),
    method: intent.method.trim(),
    humanSummary: redactSecrets(intent.humanSummary),
  };
}

export interface SanitizedQueryInput {
  query: string;
  history: ChatHistoryMessage[];
  sessionContext?: SessionContext;
}

/**
 * Pipeline stage 1: sanitize user-facing input before LLM parse.
 * Flow: sanitize input → LLM parse → sanitizeIntentForMcp → MCP execute.
 */
export function prepareSanitizedQueryInput(input: {
  query: string;
  history?: ChatHistoryMessage[];
  sessionContext?: SessionContext;
}): SanitizedQueryInput {
  return {
    query: sanitizeQueryText(input.query),
    history: sanitizeChatHistory(input.history),
    sessionContext: sanitizeSessionContextForLlm(input.sessionContext),
  };
}
