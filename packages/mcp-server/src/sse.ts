#!/usr/bin/env node
import { createServer } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { createNlRpcEngine } from "@pokt-mcp/nl-rpc";
import { createPocketClient, getRegistrySource, initRegistry, listChains, resolveChain } from "@pokt-mcp/pocket-client";
import { logLlmConfigStatus, validateLlmConfig } from "@pokt-mcp/shared";
import { createWalletBridge } from "@pokt-mcp/wallet-bridge";
import { MCP_SERVER_INSTRUCTIONS, MCP_TOOL_GUIDE } from "./instructions.js";
import { registerAgentTools } from "./tools/agent.js";
import { registerAuditTools } from "./tools/audit.js";
import { registerFeatureTools } from "./tools/features.js";
import { registerDiscoveryTools } from "./tools/discovery.js";
import { registerNlTools } from "./tools/nl.js";
import { registerQueryTools } from "./tools/query.js";
import { registerReadTools } from "./tools/read.js";
import { registerRpcTools } from "./tools/rpc.js";
import { registerWalletTools } from "./tools/wallet.js";
import { registerPocketResources } from "./resources.js";
import { registerPocketPrompts } from "./prompts.js";

function registerToolGuideResource(server: McpServer) {
  server.registerResource(
    "tool-guide",
    "pokt://tool-guide",
    {
      title: "Pocket MCP Tool Selection Guide",
      description: "How to choose the right pokt-mcp tool",
      mimeType: "text/plain",
    },
    async () => ({
      contents: [
        {
          uri: "pokt://tool-guide",
          mimeType: "text/plain",
          text: MCP_TOOL_GUIDE,
        },
      ],
    }),
  );
}

export async function createMcpApp() {
  await initRegistry();
  const pocket = createPocketClient();
  const nlRpc = createNlRpcEngine();
  const wallet = createWalletBridge();
  const server = new McpServer(
    { name: "pokt-mcp", version: "0.1.0" },
    { instructions: MCP_SERVER_INSTRUCTIONS },
  );

  registerQueryTools(server, { pocket });
  registerDiscoveryTools(server, { listChains, resolveChain, getRegistrySource });
  registerReadTools(server, { pocket, resolveChain });
  registerAuditTools(server, { pocket });
  registerFeatureTools(server, { pocket });
  registerRpcTools(server, { pocket, resolveChain });
  registerNlTools(server, { nlRpc, pocket });
  registerAgentTools(server, { pocket });
  registerWalletTools(server, { wallet, pocket, resolveChain });
  registerToolGuideResource(server);
  registerPocketResources(server);
  registerPocketPrompts(server);

  logLlmConfigStatus("pokt-mcp");
  const validation = validateLlmConfig();
  for (const warning of validation.warnings) {
    console.error(`[pokt-mcp] Fix: ${warning}`);
  }

  return server;
}

export async function startHttpMcp(port = 3002) {
  const server = await createMcpApp();
  const transports = new Map<string, SSEServerTransport>();

  const httpServer = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host}`);

    if (url.pathname === "/sse" && req.method === "GET") {
      const transport = new SSEServerTransport("/message", res);
      transports.set(transport.sessionId, transport);
      await server.connect(transport);
      return;
    }

    if (url.pathname === "/message" && req.method === "POST") {
      const sessionId = url.searchParams.get("sessionId");
      const transport = sessionId ? transports.get(sessionId) : undefined;
      if (!transport) {
        res.writeHead(404).end("Unknown session");
        return;
      }
      await transport.handlePostMessage(req, res);
      return;
    }

    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("pokt-mcp SSE endpoint. Connect via GET /sse");
  });

  httpServer.listen(port, () => {
    console.log(`pokt-mcp SSE MCP listening on http://localhost:${port}/sse`);
  });
}
