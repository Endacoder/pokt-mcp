#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMcpApp, startHttpMcp } from "./sse.js";

async function main() {
  const args = process.argv.slice(2);
  const httpFlag = args.includes("--http");
  const portArg = args.find((a) => a.startsWith("--port="));
  const port = portArg ? Number(portArg.split("=")[1]) : 3002;

  if (httpFlag) {
    await startHttpMcp(port);
    return;
  }

  const server = await createMcpApp() as McpServer;
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("pokt-mcp stdio server started");
}

main().catch((err) => {
  console.error("pokt-mcp fatal:", err);
  process.exit(1);
});

process.on("SIGINT", () => process.exit(0));
process.on("SIGTERM", () => process.exit(0));
