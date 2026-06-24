import type { ChatHistoryMessage } from "@pokt-mcp/shared";
import { sanitizeChatHistory } from "@pokt-mcp/shared";
import { isVagueFollowUp } from "./follow-up-phrases.js";

const STATUS_ONLY_USER =
  /^(did\s+that|how\s+about|what\s+about|any\s+update|status)/i;

function lastRelevantUserMessage(history: ChatHistoryMessage[]): string | undefined {
  for (let i = history.length - 1; i >= 0; i--) {
    const msg = history[i];
    if (msg.role !== "user" || !msg.content.trim()) continue;
    const text = msg.content.trim();
    if (STATUS_ONLY_USER.test(text) && i > 0) continue;
    return text;
  }
  return undefined;
}

function lastAssistantSnippet(history: ChatHistoryMessage[]): string | undefined {
  for (let i = history.length - 1; i >= 0; i--) {
    const msg = history[i];
    if (msg.role === "assistant" && msg.content.trim()) {
      const snippet = msg.content.trim().slice(0, 120);
      return snippet.length < msg.content.trim().length ? `${snippet}…` : snippet;
    }
  }
  return undefined;
}

/** Prepend prior turn so template matchers see conversational context. */
export function expandFollowUpQuery(
  query: string,
  history?: ChatHistoryMessage[],
): string {
  if (!history?.length || !isVagueFollowUp(query)) return query;
  const previous = lastRelevantUserMessage(history);
  if (!previous) return query;
  const assistant = lastAssistantSnippet(history);
  const context = assistant ? ` | Context: "${assistant}"` : "";
  return `Previous: "${previous}" | Follow-up: ${query}${context}`;
}

export function normalizeChatHistory(
  history?: ChatHistoryMessage[],
  maxMessages = 20,
  maxContent = 800,
): ChatHistoryMessage[] {
  return sanitizeChatHistory(history, maxMessages, maxContent);
}
