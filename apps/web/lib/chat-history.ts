import type { ChatHistoryMessage } from "@pokt-mcp/shared";
import type { Message } from "./types";
import { sanitizeAssistantContent } from "./tool-calls";

const MAX_HISTORY_MESSAGES = 20;
const MAX_CONTENT_LENGTH = 800;

function truncateContent(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length <= MAX_CONTENT_LENGTH) return trimmed;
  return `${trimmed.slice(0, MAX_CONTENT_LENGTH)}…`;
}

/** Build prior turns for the chat API (completed messages only). */
export function buildChatHistory(messages: Message[]): ChatHistoryMessage[] {
  const history: ChatHistoryMessage[] = [];

  for (const msg of messages) {
    if (msg.role === "user") {
      const content = truncateContent(msg.content);
      if (content) history.push({ role: "user", content });
      continue;
    }

    if (msg.role === "assistant") {
      const content = truncateContent(sanitizeAssistantContent(msg.content));
      if (!content || msg.streaming) continue;
      history.push({ role: "assistant", content });
    }
  }

  if (history.length <= MAX_HISTORY_MESSAGES) return history;
  return history.slice(-MAX_HISTORY_MESSAGES);
}
