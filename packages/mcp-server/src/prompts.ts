import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

type PromptArgs = Record<string, string | undefined>;

type PromptServer = {
  registerPrompt: (
    name: string,
    meta: {
      title: string;
      description: string;
      argsSchema?: Record<string, z.ZodTypeAny>;
    },
    handler: (args: PromptArgs) => Promise<{ messages: Array<{ role: "user"; content: { type: "text"; text: string } }> }>,
  ) => void;
};

export function registerPocketPrompts(server: McpServer) {
  const s = server as unknown as PromptServer;

  s.registerPrompt(
    "analyze-wallet",
    {
      title: "Analyze wallet portfolio",
      description: "Multi-chain portfolio analysis using pocket_query and wallet_get_status",
      argsSchema: {
        address: z.string().optional(),
        chains: z.string().optional(),
      },
    },
    async ({ address, chains }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Analyze wallet portfolio${address ? ` for ${address}` : " for connected wallet"}.
${chains ? `Focus on chains: ${chains}.` : "Check native and known token balances across relevant chains."}
Steps:
1. wallet_get_status if no address provided
2. pocket_query for native balances per chain
3. pocket_query for USDC/USDT balances where supported
4. Summarize holdings in a concise table`,
          },
        },
      ],
    }),
  );

  s.registerPrompt(
    "explain-tx",
    {
      title: "Explain transaction",
      description: "Fetch and explain a transaction receipt in plain language",
      argsSchema: {
        chain: z.string(),
        hash: z.string(),
      },
    },
    async ({ chain, hash }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Explain transaction ${hash} on ${chain}.
Steps:
1. pocket_get_transaction for ${chain} / ${hash}
2. pocket_get_receipt for ${chain} / ${hash}
3. Summarize: from, to, value, status, gas used, and key log events`,
          },
        },
      ],
    }),
  );

  s.registerPrompt(
    "build-contract-call",
    {
      title: "Build contract call",
      description: "Guide ABI encoding for pocket_call_contract",
      argsSchema: {
        chain: z.string(),
        contract: z.string(),
        function: z.string(),
        args: z.string().optional(),
      },
    },
    async ({ chain, contract, function: fn, args }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Build a read-only contract call on ${chain}.
Contract: ${contract}
Function: ${fn}
Args: ${args ?? "[]"}
Steps:
1. Encode calldata for ${fn}
2. pocket_call_contract with chain=${chain}, to=<contract>, data=<calldata>
3. Decode and explain the result`,
          },
        },
      ],
    }),
  );
}
