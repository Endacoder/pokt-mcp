import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

export type SimpleToolServer = {
  tool: (
    name: string,
    description: string,
    schema: Record<string, z.ZodTypeAny>,
    handler: (args: any) => Promise<ReturnType<typeof textResult>>,
  ) => void;
};

export function asToolServer(server: McpServer): SimpleToolServer {
  return server as unknown as SimpleToolServer;
}

export function textResult(data: unknown, isError = false) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
    ...(isError ? { isError: true as const } : {}),
  };
}

export function chainNotFound(chain: string) {
  return textResult({ error: `CHAIN_NOT_FOUND: ${chain}` }, true);
}
