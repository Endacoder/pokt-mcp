import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

export const READ_ONLY_ANNOTATION: ToolAnnotations = { readOnlyHint: true };

export type SimpleToolServer = {
  tool: (
    name: string,
    description: string,
    schema: Record<string, z.ZodTypeAny>,
    handler: (args: any) => Promise<ReturnType<typeof textResult>>,
    annotations?: ToolAnnotations,
  ) => void;
};

export function asToolServer(server: McpServer): SimpleToolServer {
  const s = server as unknown as {
    tool: (
      name: string,
      description: string,
      schema: Record<string, z.ZodTypeAny>,
      annotations: ToolAnnotations,
      handler: (args: any) => Promise<ReturnType<typeof textResult>>,
    ) => void;
  };

  return {
    tool(name, description, schema, handler, annotations) {
      if (annotations) {
        s.tool(name, description, schema, annotations, handler);
      } else {
        (server as unknown as SimpleToolServer).tool(name, description, schema, handler);
      }
    },
  };
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
