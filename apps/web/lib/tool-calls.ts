/** Internal orchestration tools — never shown in chat UI. */
export const HIDDEN_TOOL_CALLS = new Set(["pocket_query_nl", "pocket_query"]);

export function isHiddenToolCall(tool: string): boolean {
  return HIDDEN_TOOL_CALLS.has(tool);
}

/** Strip internal status text from streamed assistant content. */
export function sanitizeAssistantContent(content: string): string {
  return content.replace(/^Parsing query\.\.\.\n?/i, "").trimStart();
}

export function isPlaceholderAssistantContent(content: string): boolean {
  return !sanitizeAssistantContent(content).trim();
}
