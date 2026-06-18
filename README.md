# pokt-mcp

**AI & Agents — MCP × Pocket × Natural Language RPC**

MCP server and web demo that lets AI agents query 20+ blockchains via [Pocket Network](https://pocket.network)'s decentralized API portal, translate natural language into validated JSON-RPC calls, connect wallets, and send transactions.

## Quick start

```bash
npm install
npm run build
npm run test
```

### Run locally

```bash
# Terminal 1 — API (port 3001)
node packages/api/dist/index.js

# Terminal 2 — Web UI (port 3000)
npm run dev -w @pokt-mcp/web

# Terminal 3 — MCP server (stdio for Cursor)
node packages/mcp-server/dist/index.js
```

Or use Docker:

```bash
docker-compose up --build
./scripts/smoke-test.sh
```

### Cursor MCP config

Copy [examples/cursor-mcp.json](./examples/cursor-mcp.json) into Cursor MCP settings.

## Architecture

```
Web UI → API (Hono) → Agent + NL-RPC → Pocket Client → Pocket Portal
Cursor → MCP Server (stdio/SSE) → Pocket Client / Wallet Bridge
Browser Wallet → sign tx → broadcast via Pocket
```

## Packages

| Package | Description |
|---------|-------------|
| `@pokt-mcp/shared` | Shared types + OpenAPI spec |
| `@pokt-mcp/pocket-client` | Pocket JSON-RPC client + 20 chain registry |
| `@pokt-mcp/tx-builder` | viem transaction builder |
| `@pokt-mcp/wallet-bridge` | Injected wallet + raw tx broadcast |
| `@pokt-mcp/nl-rpc` | Natural language → RpcIntent |
| `@pokt-mcp/agent-orchestrator` | Chat agent loop (template-only) |
| `@pokt-mcp/server` | MCP tool server (stdio + SSE) |
| `@pokt-mcp/api` | REST + SSE API |
| `@pokt-mcp/web` | Next.js chat demo |

## Example prompts

| Prompt | Result |
|--------|--------|
| "List chains available on Pocket" | Chain registry |
| "Latest block on Base" | `eth_blockNumber` via Pocket |
| "Balance of 0x… on polygon" | `eth_getBalance` |
| "Send 0.01 ETH to 0x…" | Tx preview → wallet confirm |

## Configuration

See [.env.example](./.env.example).

## Docs

- [DESIGN.md](./docs/DESIGN.md)
- [ARCHITECTURE.md](./docs/ARCHITECTURE.md)
- [MCP_TOOLS.md](./docs/MCP_TOOLS.md)
- [DEVELOPMENT_PLAN.md](./docs/DEVELOPMENT_PLAN.md)
- [SECURITY.md](./docs/SECURITY.md)

## License

[MIT](./LICENSE)
