# pokt-mcp

**AI & Agents — MCP × Pocket × Natural Language RPC**

MCP server and tooling that lets AI agents query 60+ blockchains via [Pocket Network](https://pocket.network)'s decentralized API portal, translate natural language into validated JSON-RPC calls, connect wallets, and send transactions — with full RPC coverage and safe-by-default write guardrails.

## What it does

- **MCP tools** for Cursor, Claude Desktop, and custom agents
- **Pocket-native routing** to `https://{chain-slug}.api.pocket.network`
- **Natural language RPC** — "What's the ETH balance of vitalik.eth?" → validated `eth_getBalance`
- **Full JSON-RPC** via `pocket_rpc_call` for any method
- **Wallet connect & send** — WalletConnect / injected wallet, user signs, agent broadcasts

## Architecture

```
AI Client → MCP Server → Pocket Client → Pocket Portal
                       ↘ NL-RPC (intent parsing)
                       ↘ Wallet Bridge → User Wallet
```

See [docs/DESIGN.md](./docs/DESIGN.md) for the full design, [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) for technical details, [docs/MCP_TOOLS.md](./docs/MCP_TOOLS.md) for the tool catalog, and [docs/DEVELOPMENT_PLAN.md](./docs/DEVELOPMENT_PLAN.md) for the 4-team parallel build plan.

## Quick start (planned)

```bash
npm install
npm run build
```

### Cursor MCP config

Copy [examples/cursor-mcp.json](./examples/cursor-mcp.json) into your Cursor MCP settings:

```json
{
  "mcpServers": {
    "pokt-mcp": {
      "command": "npx",
      "args": ["-y", "@pokt-mcp/server"],
      "env": {
        "POCKET_DEFAULT_CHAIN": "eth"
      }
    }
  }
}
```

### Example agent prompts

| Prompt | Tool used |
|--------|-------------|
| "List chains available on Pocket" | `pocket_list_chains` |
| "Latest block on Base" | `pocket_query_nl` |
| "Call eth_getCode on 0x… on Ethereum" | `pocket_rpc_call` |
| "Send 0.01 ETH to 0x…" | `wallet_send_transaction` (with confirmation) |

## Packages

| Package | Description |
|---------|-------------|
| `@pokt-mcp/pocket-client` | Pocket JSON-RPC HTTP client + chain registry |
| `@pokt-mcp/nl-rpc` | Natural language → RpcIntent parser |
| `@pokt-mcp/wallet-bridge` | WalletConnect + transaction signing |
| `@pokt-mcp/server` | MCP tool server |

## Configuration

```bash
POCKET_DEFAULT_CHAIN=eth
POCKET_PORTAL_BASE=https://api.pocket.network
WALLETCONNECT_PROJECT_ID=...
MAX_SEND_VALUE_ETH=1.0
REQUIRE_CONFIRMATION=true
ALLOW_LOCAL_SIGNER=false
```

## Security

Read operations are open. All writes require explicit user confirmation and wallet signature. Private keys never enter the LLM context.

See [docs/SECURITY.md](./docs/SECURITY.md).

## Implementation status

| Phase | Status |
|-------|--------|
| Design & architecture | ✅ Complete |
| Pocket client + registry | 🚧 Scaffold |
| MCP server (read tools) | 🚧 Scaffold |
| Natural language RPC | 📋 Planned |
| Wallet connect & send | 📋 Planned |

## References

- [Pocket API Portal](https://docs.pocket.network/foundation/api-portal/)
- [Supported Chains](https://docs.pocket.network/developers/supported-chains/)
- [Model Context Protocol](https://modelcontextprotocol.io)

## License

[MIT](./LICENSE)
