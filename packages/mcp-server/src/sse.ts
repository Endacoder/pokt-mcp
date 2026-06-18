#!/usr/bin/env node
import { createServer } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { createNlRpcEngine } from "@pokt-mcp/nl-rpc";
import { createPocketClient, listChains, resolveChain } from "@pokt-mcp/pocket-client";
import { createWalletBridge } from "@pokt-mcp/wallet-bridge";
import { registerDiscoveryTools } from "./tools/discovery.js";
import { registerNlTools } from "./tools/nl.js";
import { registerReadTools } from "./tools/read.js";
import { registerRpcTools } from "./tools/rpc.js";
import { registerWalletTools } from "./tools/wallet.js";

export function createMcpApp() {
  const pocket = createPocketClient();
  const nlRpc = createNlRpcEngine();
  const wallet = createWalletBridge();
  const server = new McpServer({ name: "pokt-mcp", version: "0.1.0" });

  registerDiscoveryTools(server, { listChains, resolveChain });
  registerReadTools(server, { pocket, resolveChain });
  registerRpcTools(server, { pocket, resolveChain });
  registerNlTools(server, { nlRpc, pocket });
  registerWalletTools(server, { wallet, pocket, resolveChain });

  return server;
}

export async function startHttpMcp(port = 3002) {
  const server = createMcpApp();
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
