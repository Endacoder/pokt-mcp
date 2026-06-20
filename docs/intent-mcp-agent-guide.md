# Agent Guide — Intent MCP (Third-Party Integration)

> **Third-party service:** [Intent MCP](https://mcp.metalift.ai/mcp) is operated by Metalift, not this repository. This guide is an optional integration reference only. pokt-mcp does not maintain Intent MCP tools, API keys, uptime, or support terms.

This guide helps AI agents use Intent MCP safely for blockchain swaps and cross-chain intents when configured as a **separate MCP server** alongside pokt-mcp.

## Workflow

```
1. list_supported_chains     → discover networks
2. search_token              → get valid token addresses
3. get_swap_quote            → get best price
4. [Show quote to user, get confirmation]
5. prepare_intent            → lock quote, get signing payload
6. simulate_intent           → optional pre-flight check
7. get_signing_instructions  → guide user to sign in wallet
8. submit_signed_intent      → after user signs
9. get_intent_status         → track until complete
```

## Critical Rules

1. **Never invent token addresses.** Always use `search_token` first.
2. **Never ask for private keys or seed phrases.**
3. **Always get explicit user confirmation** before calling `prepare_intent`.
4. **Set `userConfirmed: true`** only after the user says yes.
5. **Quotes expire in 60 seconds.** Re-quote if expired.
6. **Default slippage is 300 bps (3%).** Max is 1000 bps (10%).

## Tool Reference

### list_supported_chains

No inputs. Returns chain IDs, names, and native symbols.

### search_token

```
chainId: 8453
query: "USDC"
```

Returns matching tokens with addresses and decimals. Use the address in subsequent calls.

### get_swap_quote

Example — swap 100 USDC for ETH on Base:

```
fromChain: 8453
toChain: 8453
tokenIn: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
tokenOut: "0x4200000000000000000000000000000000000006"
amount: "100000000"
slippageBps: 300
```

Amount is in smallest units (USDC has 6 decimals, so 100 USDC = `"100000000"`).

Response includes `quoteId`, estimated output, `platformFeeBps`, `compliance` disclosures, and `nextStep`. Provider names are not exposed — routes appear as generic labels.

### compare_quotes

Same inputs as `get_swap_quote` plus optional `limit` (2-5). Returns best quote plus alternatives.

### prepare_intent

```
quoteId: "q_abc123"
userConfirmed: true
walletAddress: "0x..."  // optional but recommended
```

**Only call after user explicitly confirms.** Returns intent ID and signing instructions — not raw calldata.

### simulate_intent

```
intentId: "int_abc123"
```

Runs on-chain simulation. Check `success: true` before asking user to sign.

### get_signing_instructions

```
intentId: "int_abc123"
```

Returns step-by-step instructions and optional WalletConnect URI for the user.

### submit_signed_intent

```
intentId: "int_abc123"
signature: "0x..."
```

Only call after the user has signed in their wallet.

### get_intent_status

```
intentId: "int_abc123"
```

Poll until status is `completed` or `failed`.

## Example Agent Conversation

**User:** "Swap 50 USDC to ETH on Base"

**Agent steps:**
1. Call `search_token(chainId: 8453, query: "USDC")` → get USDC address
2. Call `search_token(chainId: 8453, query: "WETH")` → get WETH address
3. Call `get_swap_quote(fromChain: 8453, toChain: 8453, tokenIn: USDC_ADDR, tokenOut: WETH_ADDR, amount: "50000000")`
4. Present quote to user: "You'll receive ~0.014 ETH for 50 USDC. Platform fee: 25 bps. Proceed?"
5. After user confirms: `prepare_intent(quoteId: "...", userConfirmed: true)`
6. `get_signing_instructions(intentId: "...")` → guide user to sign
7. After signing: `submit_signed_intent(...)` then `get_intent_status(...)`

## Cross-Chain Example

Swap USDC on Ethereum to USDC on Base:

```
fromChain: 1
toChain: 8453
tokenIn: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"
tokenOut: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
amount: "1000000000"
```

Cross-chain routes are selected automatically based on the best available quote.

## Error Handling

| Error | Action |
|-------|--------|
| `QUOTE_EXPIRED` | Call `get_swap_quote` again |
| `VALIDATION_ERROR` | Check token addresses via `search_token` |
| `RATE_LIMIT` | Wait and retry |
| `SIMULATION_FAILED` | Do not proceed — inform user |
| Token not in allowlist | Use `search_token` to find supported tokens |

## Amount Conversion

| Token | Decimals | 1 unit amount string |
|-------|----------|---------------------|
| ETH/WETH | 18 | `"1000000000000000000"` |
| USDC | 6 | `"1000000"` |
| USDT | 6 | `"1000000"` |
| DAI | 18 | `"1000000000000000000"` |

Formula: `amount = humanAmount * 10^decimals`

## Using with pokt-mcp

**Division of responsibility:**

| Server | Scope |
|--------|-------|
| **pokt-mcp** (this repo) | Balances, blocks, gas, RPC reads, native sends via `pocket_query` |
| **Intent MCP** (third-party) | Swap execution, cross-chain intents, signing flow |

For swap **execution**, use Intent MCP exclusively — do not use pokt-mcp's `pocket_rpc_call` or `wallet_send_transaction` for swaps.

See also: [USE_CASES.md](USE_CASES.md) (pokt-mcp capabilities) and [USE_CASES.md#third-party-mcp-integrations-optional](USE_CASES.md#third-party-mcp-integrations-optional).
