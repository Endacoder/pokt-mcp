# pokt-mcp
**DEMO**
https://pokt.metalift.ai

**AI & Agents — MCP × Pocket × Natural Language RPC**

MCP server and web demo that lets AI agents query 20+ blockchains via [Pocket Network](https://pocket.network)'s decentralized API portal, translate natural language into validated JSON-RPC calls, connect wallets, and send transactions.

## Build on Pocket

**Competition project document:** [docs/BOP.md](./docs/BOP.md) — team info, problem/solution, Pocket usage, demo links, and weekly progress updates for judges.


### Cursor MCP config

Copy the `pokt-mcp` block from [examples/cursor-mcp.json](./examples/cursor-mcp.json) into Cursor MCP settings. The optional `intent-mcp` block is a **third-party** swap server (Metalift) — not required for reads or native sends.

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
| `@pokt-mcp/wallet-bridge` | Injected + WalletConnect browser signing |
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
| "USDC balance of 0x… on Base" | ERC-20 balance via `pocket_query` |
| "Send 0.01 ETH to 0x…" | Tx preview → wallet confirm |
| "Swap 50 USDC to ETH on Base" | Error — configure third-party swap MCP |

## Configuration

See [.env.example](./.env.example).

## Docs

- [BOP.md](./docs/BOP.md) — Build on Pocket competition project document
- [USE_CASES.md](./docs/USE_CASES.md) — full use case catalog
- [DEMO_PROMPTS.md](./docs/DEMO_PROMPTS.md) — copy-paste prompts to test each feature
- [MCP_TOOLS.md](./docs/MCP_TOOLS.md)
- [DESIGN.md](./docs/DESIGN.md)
- [ARCHITECTURE.md](./docs/ARCHITECTURE.md)
- [DEVELOPMENT_PLAN.md](./docs/DEVELOPMENT_PLAN.md)
- [SECURITY.md](./docs/SECURITY.md)
- [intent-mcp-agent-guide.md](./docs/intent-mcp-agent-guide.md) — optional third-party swap MCP (Metalift)

## License

[MIT](./LICENSE)
