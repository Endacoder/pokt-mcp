export type ToolCall = {
  tool: string;
  input?: unknown;
  intent?: Record<string, unknown>;
  status: "running" | "done" | "error";
  latencyMs?: number;
  output?: unknown;
};

export type Message =
  | { role: "user"; content: string }
  | {
      role: "assistant";
      content: string;
      result?: Record<string, unknown>;
      error?: string;
      streaming?: boolean;
      toolCalls?: ToolCall[];
      /** Live status lines streamed during processing. */
      thinkingLog?: string[];
      /** Model reasoning / chain-of-thought streamed before the answer. */
      reasoning?: string;
      /** Set when the user stops generation mid-stream. */
      interrupted?: boolean;
    };

export type Conversation = {
  id: string;
  sessionId: string;
  title: string;
  chain: string;
  messages: Message[];
  updatedAt: number;
};
