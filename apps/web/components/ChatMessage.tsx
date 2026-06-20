"use client";

import { MarkdownContent } from "./MarkdownContent";
import { MessageActions } from "./MessageActions";
import { ResultCard } from "./ResultCard";
import { ToolCallsSummary, visibleToolCalls } from "./ToolCallsSummary";
import { ThinkingPanel } from "./ThinkingPanel";
import { TypingIndicator } from "./TypingIndicator";
import { isPlaceholderAssistantContent, sanitizeAssistantContent } from "../lib/tool-calls";
import { BRAND } from "../lib/brand";
import type { Message } from "../lib/types";

type SwapConfirmPayload = {
  quoteId: string;
  display: {
    chainName: string;
    amountIn: string;
    tokenIn: string;
    amountInAtomic: string;
    tokenInAddress: string;
    amountOut: string;
    tokenOut: string;
    quoteId: string;
    expiresAt: string;
    route: string;
    platformFeeBps: number;
    gasless: boolean;
    gasEstimateUsd?: number;
    priceImpactBps?: number;
    warnings: string[];
  };
};

export function ChatMessage({
  message,
  chain,
  toolDetailsExpanded,
  onRetry,
  walletConnected,
  onConfirmSwap,
  compactTop = false,
}: {
  message: Message;
  chain?: string;
  toolDetailsExpanded?: boolean;
  onRetry?: () => void;
  walletConnected?: boolean;
  onConfirmSwap?: (swap: SwapConfirmPayload) => void;
  /** Tighter spacing when consecutive messages share the same role. */
  compactTop?: boolean;
}) {
  const isUser = message.role === "user";
  const shownToolCalls = visibleToolCalls(
    message.role === "assistant" ? (message.toolCalls ?? []) : [],
  );
  const displayContent =
    message.role === "assistant" ? sanitizeAssistantContent(message.content) : message.content;
  const isSwapQuoteResult =
    message.role === "assistant" && message.result?.route === "intent-swap";
  const showAssistantBubble =
    (isUser || displayContent || (message.streaming && !displayContent)) &&
    !(isSwapQuoteResult && displayContent.startsWith("### Swap quote"));
  const showTyping =
    !isUser &&
    message.streaming &&
    isPlaceholderAssistantContent(message.content) &&
    shownToolCalls.length === 0 &&
    !(message.role === "assistant" && (message.thinkingLog?.length ?? 0) > 0);

  const thinkingLines = message.role === "assistant" ? (message.thinkingLog ?? []) : [];
  const showThinking = !isUser && message.streaming && thinkingLines.length > 0;
  const isStreamingText =
    !isUser && message.streaming && Boolean(displayContent) && !message.interrupted;

  return (
    <article
      className={`group animate-fade-in ${compactTop ? "mt-2" : "mt-5"}`}
      aria-label={isUser ? "Your message" : "Assistant message"}
    >
      <div className={`flex flex-col ${isUser ? "items-end" : "items-start"}`}>
        <p
          className={`mb-1.5 flex items-center gap-1.5 px-1 text-[11px] font-semibold uppercase tracking-wider ${
            isUser ? "text-pocket-muted" : "text-pocket-violet"
          }`}
        >
          {!isUser && (
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-pocket-violet" aria-hidden />
          )}
          {isUser ? "You" : BRAND.agentLabel}
        </p>

        <div className={`w-full max-w-[min(100%,42rem)] space-y-2 ${isUser ? "items-end" : "items-start"}`}>
          {!isUser && showThinking && (
            <ThinkingPanel lines={thinkingLines} active={Boolean(message.streaming)} />
          )}

          {!isUser && shownToolCalls.length > 0 && (
            <ToolCallsSummary
              toolCalls={message.toolCalls ?? []}
              defaultOpen={toolDetailsExpanded}
            />
          )}

          {(isUser || showAssistantBubble) && (
            <div
              className={`rounded-2xl px-4 py-3 text-[0.9375rem] leading-relaxed ${
                isUser
                  ? "bubble-user rounded-br-md"
                  : "bubble-assistant rounded-bl-md"
              } ${isStreamingText ? "stream-cursor" : ""}`}
            >
              {isUser ? (
                <p className="whitespace-pre-wrap break-words">{displayContent}</p>
              ) : showTyping ? (
                <TypingIndicator />
              ) : displayContent && showAssistantBubble ? (
                <MarkdownContent content={displayContent} chain={chain} />
              ) : null}
            </div>
          )}

          {!isUser && message.interrupted && (
            <p className="px-1 text-xs text-pocket-muted">
              Response stopped — you can regenerate or edit your prompt.
            </p>
          )}

          {!isUser && (
            <>
              {message.error && <ResultCard error={message.error} />}
              {message.result && (
                <ResultCard
                  data={message.result}
                  walletConnected={walletConnected}
                  onConfirmSwap={onConfirmSwap}
                />
              )}
              {!message.streaming && (
                <MessageActions message={message} onRetry={onRetry} />
              )}
            </>
          )}
        </div>
      </div>
    </article>
  );
}
