# POKT MCP — Build on Pocket Project Document

Canonical project document for the **Build on Pocket (BoP)** competition. Judges: start here, then follow links to deeper technical docs.

---

## Project metadata

| Field | Value |
|-------|--------|
| **Project name** | POKT MCP (`pokt-mcp`) |
| **Tagline** | AI Agents × Pocket Network × MCP |
| **Track / category** | AI & Agents |
| **Team members** | Team Member 1, Team Member 2, Team Member 3 *(replace with real names/handles)* |
| **Repository** | [github.com/Endacoder/pokt-mcp-private](https://github.com/Endacoder/pokt-mcp-private) *(private — judges have been granted access)* |
| **Live demo** | [https://pokt.metalift.ai](https://pokt.metalift.ai) |
| **Local demo** | `docker-compose up --build` → http://localhost:3000 (see [README](../README.md)) |

---

## Problem statement

AI agents and developer tools need reliable, multi-chain blockchain access. Today that usually means:

- Hardcoding RPC URLs and API keys per chain (Alchemy, Infura, etc.)
- Letting LLMs invent JSON-RPC methods or parameters
- Mixing read-only queries with destructive writes without guardrails
- No standard protocol for exposing chain access to tools like Cursor or Claude Desktop

[Pocket Network](https://pocket.network)'s Shannon-era public portal (`https://{chain-slug}.api.pocket.network`) provides keyless, decentralized JSON-RPC across 60+ networks — but there is no MCP-native, natural-language layer on top of it for AI agents.

---

## Solution overview

**POKT MCP** is an AI-native blockchain access layer: an MCP server, REST API, and web chat demo that route all chain reads and transaction broadcasts through Pocket Network's decentralized RPC portal.

Users ask questions in plain English ("latest block on Base", "USDC balance of 0x…", "send 0.01 ETH to 0x…"). The system translates intent into validated JSON-RPC calls, executes them via Pocket, and returns structured results. Wallet connect/sign flows keep private keys out of agent context; a policy layer blocks dangerous RPC methods and requires explicit confirmation for writes.

**Core capabilities:**

- **MCP server** (stdio + HTTP/SSE) exposing typed Pocket tools for Cursor, Claude Desktop, and custom agents
- **Natural language → RPC** via `nl-rpc` (template-first, optional LLM fallback)
- **Web chat demo** with wallet connect (MetaMask / WalletConnect), tx preview, and confirm modal
- **Multi-step agent loop** for complex research (logs, portfolio, gas comparison)
- **Policy & audit layer** denying unsafe methods and gating high-risk writes

See [DESIGN.md](./DESIGN.md) and [ARCHITECTURE.md](./ARCHITECTURE.md) for full technical detail.

---

## Project scope: included vs not included

Judges should be able to see at a glance what **this repo ships** versus what relies on **optional external services**. Pocket Network is the only required external dependency for core on-chain functionality.

### Included in this project (pokt-mcp repo)

All of the following is implemented and maintained in this repository:

| Component | Package / path | Notes |
|-----------|----------------|-------|
| **Pocket RPC client** | `packages/pocket-client` | Sole chain transport — reads, gas, nonce, broadcast |
| **26-chain registry** | `packages/pocket-client/src/registry/chains.json` | Maps slugs → `{slug}.api.pocket.network` |
| **MCP server** | `packages/mcp-server` | stdio + HTTP/SSE; typed Pocket tools |
| **REST + SSE API** | `packages/api` | Chat streaming, RPC proxy, broadcast |
| **Web chat demo** | `apps/web` | Branded UI, wallet connect, tx confirm |
| **NL → RPC (templates)** | `packages/nl-rpc` | Regex templates + heuristics — **no LLM required** |
| **Wallet bridge** | `packages/wallet-bridge` | MetaMask injected + WalletConnect signing |
| **Tx builder** | `packages/tx-builder` | viem unsigned tx from Pocket-fetched chain state |
| **Policy & audit** | `packages/mcp-server`, `packages/api` | RPC denylist, send limits, confirmation gates |
| **Query router** | `packages/agent-orchestrator` | Routes NL to template / heuristic / agent paths |
| **Intent-swap client glue** | `packages/agent-orchestrator/src/intent-mcp-client.ts` | Thin adapter only — calls **external** Intent MCP when configured |

**Works out of the box (no API keys beyond Pocket):**

- Chain discovery, latest block, gas price, native balance, ERC-20 balance (known tokens)
- ENS name resolution (via Pocket RPC)
- Solana slot / SOL balance
- Native ETH transfer preview → wallet sign → broadcast via Pocket
- Transfer log queries via Pocket `eth_getLogs`
- Portfolio native balances across chains (Pocket RPC only; USD totals need CoinGecko — see below)

### Not included — optional external dependencies

These are **not part of the pokt-mcp codebase**. They are optional integrations the operator or end user configures separately.

| Service | Purpose | Required? | Config | What breaks without it |
|---------|---------|-----------|--------|------------------------|
| **Pocket Network portal** | All on-chain reads + tx broadcast | **Yes** | `POCKET_PORTAL_BASE` (default public portal) | Entire project non-functional for chain data |
| **LLM (OpenAI / LiteLLM)** | Broader NL parsing beyond templates; multi-step agent loop | No | `FEATURE_NL_LLM=true`, `OPENAI_API_KEY` or `LITELLM_*` | Template/heuristic queries still work; complex NL returns `NL_PARSE_FAILED`; agent loop disabled |
| **Intent MCP (Metalift)** | Same-chain swaps, cross-chain intents, swap status | No | Separate MCP entry in Cursor — see [examples/cursor-mcp.json](../examples/cursor-mcp.json) | Swap prompts error with redirect; reads/sends unaffected |
| **CoinGecko API** | Spot prices, 24h change, USD portfolio totals, currency conversion | No | None (public API, no key in v1) | Price/conversion prompts fail; all Pocket RPC queries unaffected |
| **Etherscan API V2** | Wallet tx history (`txlist`) across EVM chains | No | `EXPLORER_API_KEY` or `ETHERSCAN_API_KEY` | Tx history falls back to limited Pocket block-scan or errors with setup instructions |
| **WalletConnect Cloud** | WalletConnect pairing in web demo | No (injected MetaMask works) | `WALLETCONNECT_PROJECT_ID`, `NEXT_PUBLIC_WC_PROJECT_ID` | WC connect fails; injected wallet still works |

### Boundary diagram

```
┌─────────────────────────────────────────────────────────────┐
│  pokt-mcp (this repo)                                       │
│  MCP server · API · Web UI · nl-rpc · wallet-bridge         │
│  agent-orchestrator · pocket-client · tx-builder            │
└──────────────────────────┬──────────────────────────────────┘
                           │
         ┌─────────────────┼─────────────────┐
         │ REQUIRED        │ OPTIONAL        │
         ▼                 ▼                 ▼
   Pocket Portal      LLM provider     Intent MCP (Metalift)
   {slug}.api.         OpenAI /         swaps & cross-chain
   pocket.network      LiteLLM          (separate MCP server)
         │                 │                 │
         │            CoinGecko API      (not maintained
         │            spot price /       by this team)
         │            portfolio USD
         │
         │            Etherscan API V2
         │            tx history
         │
         │            WalletConnect Cloud
         └            (web demo only)
```

### LLM — optional, not core infrastructure

NL parsing is **template-first**. The LLM is a fallback layer, not a runtime dependency:

| Mode | Flag | Behavior |
|------|------|----------|
| **Template-only** (default off LLM) | `FEATURE_NL_LLM=false` | Blocks, balances, gas, chains, ENS, known ERC-20, Solana reads |
| **LLM-assisted NL** | `FEATURE_NL_LLM=true` + API key | Broader phrasing; routes to same Pocket RPC intents |
| **Agent loop** | `FEATURE_AGENT_LOOP=true` + LLM | Multi-step research (logs, complex queries) — still Pocket-only for RPC |

Code: [`packages/nl-rpc/src/index.ts`](../packages/nl-rpc/src/index.ts) (template → heuristic → LLM), [`packages/shared/src/llm-config.ts`](../packages/shared/src/llm-config.ts).

The demo and MCP server work without any LLM API key for all template-covered prompts in [DEMO_PROMPTS.md](./DEMO_PROMPTS.md).

### Intent MCP — third-party, not part of this project

**pokt-mcp does not implement swap execution.** Swaps require a separate MCP server (e.g. [Intent MCP / Metalift](https://mcp.metalift.ai/mcp)) configured alongside pokt-mcp in the user's MCP client.

| Concern | pokt-mcp | Intent MCP (third-party) |
|---------|----------|--------------------------|
| Ownership | This repo | Metalift — separate terms, uptime, API keys |
| Chain reads | Pocket RPC | N/A |
| Native sends | Pocket broadcast | N/A |
| Swap quotes / execution | Error + redirect | `get_swap_quote`, sign, submit |
| Code in this repo | Client adapter only ([`intent-mcp-client.ts`](../packages/agent-orchestrator/src/intent-mcp-client.ts)) | None — remote HTTP MCP |

See [intent-mcp-agent-guide.md](./intent-mcp-agent-guide.md) and [USE_CASES.md § Third-party MCP](./USE_CASES.md#third-party-mcp-integrations-optional).

### CoinGecko — third-party market data (not chain RPC)

Used only for **off-chain market data** that Pocket RPC cannot provide:

| Feature | Route | File |
|---------|-------|------|
| Spot price ("price of ETH") | `__spot_price__` | [`packages/nl-rpc/src/price.ts`](../packages/nl-rpc/src/price.ts) |
| 24h price change | `__price_change_24h__` | [`packages/nl-rpc/src/price.ts`](../packages/nl-rpc/src/price.ts) |
| Portfolio USD totals | portfolio convert | [`packages/nl-rpc/src/portfolio-convert.ts`](../packages/nl-rpc/src/portfolio-convert.ts) |
| Currency conversion | convert | [`packages/nl-rpc/src/convert.ts`](../packages/nl-rpc/src/convert.ts) |

Endpoint: `https://api.coingecko.com/api/v3/simple/price` (public, no API key in v1). On-chain balances for portfolio still come from **Pocket RPC**; CoinGecko only supplies USD prices.

### Etherscan API V2 — third-party indexed tx history (not chain RPC)

Used for **wallet transaction history** where scanning blocks via RPC is impractical:

| Feature | Route | File |
|---------|-------|------|
| Recent transactions | `__tx_history__` | [`packages/nl-rpc/src/tx-history.ts`](../packages/nl-rpc/src/tx-history.ts) |
| Payment lookup ("did X receive from me?") | `__payment_from_me__` | [`packages/nl-rpc/src/tx-history.ts`](../packages/nl-rpc/src/tx-history.ts) |

Endpoint: `https://api.etherscan.io/v2/api` (multichain via `chainid`). Requires free `EXPLORER_API_KEY`. Without it, the feature errors with setup instructions or falls back to limited Pocket `eth_getLogs` / block-scan where implemented.

**All other chain data** (balances, blocks, receipts, gas, logs for specific filters) uses **Pocket RPC only**.

---

## Target users

| User | Need | How POKT MCP helps |
|------|------|-------------------|
| **Cursor / Claude Desktop users** | Wire blockchain tools into their IDE agent | Drop-in MCP config from [examples/cursor-mcp.json](../examples/cursor-mcp.json) |
| **Agent builders** | Multi-chain reads + guarded writes without custodial keys | Typed MCP tools + wallet bridge + policy middleware |
| **Pocket Network users** | Natural-language access to 20+ chains via the public portal | All RPC traffic routes through `{slug}.api.pocket.network` |
| **Demo / hackathon judges** | Live, end-to-end proof of Pocket integration | Web UI at [pokt.metalift.ai](https://pokt.metalift.ai) + [DEMO_PROMPTS.md](./DEMO_PROMPTS.md) |

---

## How this project uses Pocket Network

Pocket Network is **not optional** — it is the sole RPC transport for all on-chain reads, gas estimation, nonce lookup, log queries, and transaction broadcast in v1.

### Where Pocket RPC is used

| Layer | File(s) | Role |
|-------|---------|------|
| HTTP client | [`packages/pocket-client/src/index.ts`](../packages/pocket-client/src/index.ts) | All JSON-RPC POSTs to `resolveEndpoint(chain)`; retry, cache, policy denylist |
| Chain registry | [`packages/pocket-client/src/registry/chains.json`](../packages/pocket-client/src/registry/chains.json), [`registry/index.ts`](../packages/pocket-client/src/registry/index.ts) | 26 chains mapped to `https://{slug}.api.pocket.network` |
| REST API | [`packages/api/src/index.ts`](../packages/api/src/index.ts) | `/rpc` and `/broadcast` proxy through `createPocketClient()` |
| MCP tools | [`packages/mcp-server/src/tools/rpc.ts`](../packages/mcp-server/src/tools/rpc.ts), [`read.ts`](../packages/mcp-server/src/tools/read.ts), [`query.ts`](../packages/mcp-server/src/tools/query.ts) | `pocket_rpc_call`, `pocket_query`, read shortcuts |
| NL execution | [`packages/nl-rpc/src/index.ts`](../packages/nl-rpc/src/index.ts) | `executeIntent()` calls `pocket.rpc()` for every resolved intent |
| Agent loop | [`packages/agent-orchestrator/src/agent-loop.ts`](../packages/agent-orchestrator/src/agent-loop.ts) | Multi-step research; system prompt enforces Pocket-only RPC |
| Query router | [`packages/agent-orchestrator/src/query-router.ts`](../packages/agent-orchestrator/src/query-router.ts) | Routes NL queries to templates, heuristics, or agent loop — all via Pocket |
| Tx lifecycle | [`packages/agent-orchestrator/src/send-status.ts`](../packages/agent-orchestrator/src/send-status.ts) | Receipt polling via `eth_getTransactionReceipt` |
| Tx builder | [`packages/tx-builder/src/index.ts`](../packages/tx-builder/src/index.ts) | Gas, nonce, and chain state fetched through Pocket before signing |
| Broadcast | `pocket-client.broadcast()` | `eth_sendRawTransaction` after wallet signs in browser |

**Data flow:**

```
Web UI / Cursor → API or MCP Server → nl-rpc / agent-orchestrator → pocket-client → Pocket Portal
Browser wallet → sign tx → wallet-bridge → pocket-client.broadcast() → Pocket Portal
```

### Why Pocket is required

1. **Keyless multi-chain access** — One endpoint pattern (`{slug}.api.pocket.network`) covers 20+ chains without per-vendor API keys in agent context.
2. **Decentralized transport** — Agent tooling should not depend on a single centralized RPC provider; Pocket's portal is the designed transport layer for this project.
3. **Competition alignment** — The project's purpose is to demonstrate AI agent tooling *on* Pocket Network, not to wrap third-party RPC.
4. **No fallback by default** — v1 uses Pocket exclusively. Optional `FALLBACK_RPC_URLS` exists for development only and is not used in the demo path.

### Endpoint pattern

```
POST https://{chain-slug}.api.pocket.network
Content-Type: application/json

{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}
```

Examples:

| Chain | Endpoint |
|-------|----------|
| Ethereum | `https://eth.api.pocket.network` |
| Base | `https://base.api.pocket.network` |
| Polygon | `https://poly.api.pocket.network` |
| Solana | `https://solana.api.pocket.network` |

Configurable via `POCKET_PORTAL_BASE` in [.env.example](../.env.example) (default: `https://api.pocket.network`).

### Impact without Pocket

If Pocket RPC were removed or unreachable:

- **All read queries fail** — balances, blocks, gas prices, logs, contract calls, ENS resolution
- **All writes fail** — gas estimation, nonce lookup, and `eth_sendRawTransaction` broadcast depend on Pocket
- **MCP tools become non-functional** — `pocket_query`, `pocket_rpc_call`, and read shortcuts have no backend
- **Web demo is empty** — chat UI, result cards, and tx confirm flow all depend on live chain data
- **Agent loop stops** — the agent system prompt explicitly forbids third-party RPC providers (Alchemy, Infura, etc.)

The project would need a complete RPC transport replacement; it is not a thin wrapper that could swap providers without rewriting `pocket-client` and all call sites.

---

## Tech stack

| Layer | Technology |
|-------|------------|
| Language | TypeScript (Node.js ≥ 20) |
| Monorepo | npm workspaces |
| MCP server | `@modelcontextprotocol/sdk` — stdio + HTTP/SSE |
| API | Hono — REST + SSE chat streaming |
| Web UI | Next.js, Tailwind CSS |
| Tx building | viem |
| Wallet | WalletConnect v2 + injected (MetaMask) |
| NL parsing | Template engine + optional OpenAI/LiteLLM (`FEATURE_NL_LLM`) |
| Agent | Multi-step tool loop (`FEATURE_AGENT_LOOP`) — optional, requires LLM |
| Deploy | Docker Compose, Cloudflare tunnel ([`docker-compose.prod.yml`](../docker-compose.prod.yml)) |
| Tests | Node built-in test runner across packages |

**Optional external services** (LLM, Intent MCP, CoinGecko, Etherscan, WalletConnect Cloud): see [Project scope: included vs not included](#project-scope-included-vs-not-included) above.

---

## Repository links

| Resource | URL |
|----------|-----|
| Source (private) | [github.com/Endacoder/pokt-mcp-private](https://github.com/Endacoder/pokt-mcp-private) |
| Cursor MCP config | [examples/cursor-mcp.json](../examples/cursor-mcp.json) |
| Architecture | [docs/ARCHITECTURE.md](./ARCHITECTURE.md) |
| MCP tool reference | [docs/MCP_TOOLS.md](./MCP_TOOLS.md) |
| Use case catalog | [docs/USE_CASES.md](./USE_CASES.md) |
| Demo prompts | [docs/DEMO_PROMPTS.md](./DEMO_PROMPTS.md) |
| Security model | [docs/SECURITY.md](./SECURITY.md) |

---

## Demo links

| Demo | URL | Notes |
|------|-----|-------|
| **Live web UI** | [https://pokt.metalift.ai](https://pokt.metalift.ai) | Production deploy via Cloudflare tunnel |
| **Local web UI** | http://localhost:3000 | After `docker-compose up` or `npm run dev:web` |
| **MCP (Cursor)** | stdio — see [examples/cursor-mcp.json](../examples/cursor-mcp.json) | No hosted MCP endpoint required |
| **MCP (HTTP/SSE)** | http://localhost:3002 | Optional: `node packages/mcp-server/dist/index.js --http --port=3002` |

**Quick demo script:**

1. Open [pokt.metalift.ai](https://pokt.metalift.ai) (or localhost:3000)
2. Ask: **"latest block on Base"** — structured result via Pocket RPC
3. Connect wallet → ask **"what's my balance?"** — `eth_getBalance` via Pocket
4. See [DEMO_PROMPTS.md](./DEMO_PROMPTS.md) for full prompt catalog

---

## Pre-BoP vs during-BoP

### Before BoP

**Nothing.** This project was created for the Build on Pocket competition. The first commit is June 13–14, 2026 (design + scaffold).

### Built during BoP

| Period | Status | Deliverables | Key commits |
|--------|--------|--------------|-------------|
| **Week 1** (Jun 13–18, 2026) | Committed & pushed | Monorepo scaffold + shared types; `pocket-client` + 26-chain registry; MCP server (stdio) with discovery, read, NL, wallet tools; REST API + SSE chat; Next.js demo UI; WalletConnect + tx confirm modal; NL template parser; policy/audit middleware; CI; smoke tests | `d29d1ef` design scaffold → `baad88c` MVP completion |
| **Week 2** (Jun 19–20, 2026) | Local / push pending | Branded chat UI (sidebar, tool-call blocks, settings drawer); agent loop + query router + complexity routing; expanded NL (portfolio, gas compare, tx history, market analytics, ENS); session signing + internal API auth + rate limiting; intent-swap integration (third-party MCP for CoW swaps — not Pocket RPC); production Docker + Cloudflare tunnel; extensive test coverage | Uncommitted at time of writing |

**Week 1 commit trail (for judges):**

```
88f74c4  Create README.md
d29d1ef  Design and scaffold AI & Agents MCP server for Pocket Network
8811284  Add 4-team parallel development plan
a4c3bfa  Implement pokt-mcp MVP: API, web UI, wallet bridge, NL agent
baad88c  Complete pokt-mcp MVP: WalletConnect, web UX, ENS, policy, CI
```

**Week 2 highlights (cross-check against working tree):**

- `packages/agent-orchestrator/` — agent loop, query router, intent-swap client
- `packages/nl-rpc/` — portfolio, gas compare, tx history, market analytics, interpret/heuristic routing
- `apps/web/` — full chat UI overhaul, branding, session auth, swap modals
- `packages/api/` — internal auth, session tokens, rate limiting
- `docker-compose.prod.yml`, `scripts/setup-cloudflare-tunnel.sh` — production demo at pokt.metalift.ai

---

## Weekly progress updates

### Week 1 (Jun 13–18, 2026)

- Designed AI & Agents MCP architecture for Pocket Network ([DESIGN.md](./DESIGN.md))
- Shipped MVP: MCP server, REST API, web chat UI, wallet bridge, NL templates
- Integrated Pocket client with 26-chain registry and policy middleware
- Added WalletConnect, tx confirm modal, ENS resolution, CI pipeline
- Commits: `d29d1ef` … `baad88c`

### Week 2 (Jun 19–20, 2026)

- Built branded chat UI with conversation sidebar, tool-call visualization, settings drawer
- Implemented agent loop + query router for multi-step Pocket RPC research
- Expanded NL capabilities: portfolio balances, gas comparison, tx history, market analytics
- Added session signing, internal API auth, and rate limiting for production deploy
- Deployed live demo at [pokt.metalift.ai](https://pokt.metalift.ai) via Cloudflare tunnel
- Added intent-swap integration (optional third-party MCP — swaps are not via Pocket RPC)
- Status: **in progress** — Week 2 changes pending push to remote

### Week 3+ *(template)*

```markdown
### Week N (Mon DD – Sun DD, YYYY)
- Bullet summary of shipped work
- Commits: <sha range or PR links>
- Demo notes / blockers
```

---

## Related documentation

| Doc | Purpose |
|-----|---------|
| [DESIGN.md](./DESIGN.md) | Problem, goals, system overview |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | Package boundaries, sequence diagrams |
| [MCP_TOOLS.md](./MCP_TOOLS.md) | Full MCP tool reference |
| [USE_CASES.md](./USE_CASES.md) | Use case catalog |
| [DEMO_PROMPTS.md](./DEMO_PROMPTS.md) | Copy-paste demo prompts |
| [SECURITY.md](./SECURITY.md) | Policy, auth, rate limits |
| [BRANDING.md](./BRANDING.md) | Brand identity and assets |
| [intent-mcp-agent-guide.md](./intent-mcp-agent-guide.md) | Optional third-party swap MCP (not part of this repo) |
