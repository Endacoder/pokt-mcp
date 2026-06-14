#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createNlRpcEngine } from "@pokt-mcp/nl-rpc";
import {
  createPocketClient,
  listChains,
  resolveChain,
} from "@pokt-mcp/pocket-client";
import { createWalletBridge } from "@pokt-mcp/wallet-bridge";
import { registerDiscoveryTools } from "./tools/discovery.js";
import { registerReadTools } from "./tools/read.js";
import { registerRpcTools } from "./tools/rpc.js";
import { registerNlTools } from "./tools/nl.js";
import { registerWalletTools } from "./tools/wallet.js";

const pocket = createPocketClient();
const nlRpc = createNlRpcEngine();
const wallet = createWalletBridge();

const server = new McpServer({
  name: "pokt-mcp",
  version: "0.1.0",
});

registerDiscoveryTools(server, { listChains, resolveChain });
registerReadTools(server, { pocket, resolveChain });
registerRpcTools(server, { pocket, resolveChain });
registerNlTools(server, { nlRpc, pocket });
registerWalletTools(server, { wallet, pocket, resolveChain });

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("pokt-mcp fatal:", err);
  process.exit(1);
});
