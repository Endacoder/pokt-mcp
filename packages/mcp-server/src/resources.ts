import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { listChains, listMethodsForProtocol } from "@pokt-mcp/pocket-client";
import type { ChainProtocol } from "@pokt-mcp/shared";
import { getAllMcpSessions } from "./session.js";

const PROTOCOLS: ChainProtocol[] = ["evm", "solana", "cosmos"];

export function registerPocketResources(server: McpServer) {
  server.registerResource(
    "chains",
    "pocket://chains",
    {
      title: "Pocket Chain Registry",
      description: "Full chain registry JSON from pokt-mcp",
      mimeType: "application/json",
    },
    async () => ({
      contents: [
        {
          uri: "pocket://chains",
          mimeType: "application/json",
          text: JSON.stringify({ chains: listChains() }, null, 2),
        },
      ],
    }),
  );

  for (const protocol of PROTOCOLS) {
    const uri = `pocket://methods/${protocol}`;
    server.registerResource(
      `methods-${protocol}`,
      uri,
      {
        title: `${protocol.toUpperCase()} RPC Methods`,
        description: `Common RPC methods for ${protocol} chains`,
        mimeType: "application/json",
      },
      async () => ({
        contents: [
          {
            uri,
            mimeType: "application/json",
            text: JSON.stringify(
              { protocol, methods: listMethodsForProtocol(protocol) },
              null,
              2,
            ),
          },
        ],
      }),
    );
  }

  server.registerResource(
    "session",
    "pocket://session",
    {
      title: "MCP Session Context",
      description: "Active MCP session contexts keyed by sessionId",
      mimeType: "application/json",
    },
    async () => ({
      contents: [
        {
          uri: "pocket://session",
          mimeType: "application/json",
          text: JSON.stringify({ sessions: getAllMcpSessions() }, null, 2),
        },
      ],
    }),
  );
}
