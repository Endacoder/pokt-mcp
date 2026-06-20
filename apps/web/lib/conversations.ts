import type { Conversation, Message } from "./types";

const STORAGE_KEY = "pokt-mcp-conversations";
const ACTIVE_KEY = "pokt-mcp-active-conversation";

export function loadConversations(): Conversation[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as Conversation[];
  } catch {
    return [];
  }
}

export function saveConversations(conversations: Conversation[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(conversations));
}

export function getActiveConversationId(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(ACTIVE_KEY);
}

export function setActiveConversationId(id: string | null): void {
  if (id) {
    localStorage.setItem(ACTIVE_KEY, id);
  } else {
    localStorage.removeItem(ACTIVE_KEY);
  }
}

export function createConversation(chain: string): Conversation {
  return {
    id: crypto.randomUUID(),
    sessionId: crypto.randomUUID(),
    title: "New chat",
    chain,
    messages: [],
    updatedAt: Date.now(),
  };
}

export function titleFromMessage(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length <= 48) return trimmed;
  return `${trimmed.slice(0, 48)}…`;
}

export function upsertConversation(
  conversations: Conversation[],
  conv: Conversation,
): Conversation[] {
  const idx = conversations.findIndex((c) => c.id === conv.id);
  if (idx >= 0) {
    const copy = [...conversations];
    copy[idx] = conv;
    return copy.sort((a, b) => b.updatedAt - a.updatedAt);
  }
  return [conv, ...conversations].sort((a, b) => b.updatedAt - a.updatedAt);
}

export function deleteConversation(conversations: Conversation[], id: string): Conversation[] {
  return conversations.filter((c) => c.id !== id);
}

export function updateConversationMessages(
  conv: Conversation,
  messages: Message[],
  title?: string,
): Conversation {
  const firstUser = messages.find((m) => m.role === "user");
  return {
    ...conv,
    messages,
    title: title ?? (firstUser ? titleFromMessage(firstUser.content) : conv.title),
    updatedAt: Date.now(),
  };
}

export function clearAllConversations(): void {
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(ACTIVE_KEY);
}
