# Agent Guide — Intent MCP Tools

> **Third-party service:** [Intent MCP](https://mcp.metalift.ai/mcp) is operated by Metalift, not this repository. This guide is an optional integration reference only. pokt-mcp does not maintain Intent MCP tools, API keys, uptime, or support terms.

This guide helps AI agents use the Intent MCP tools safely and effectively for blockchain swaps and cross-chain intents.

For a full catalog of user query patterns, see [USE_CASES.md](./USE_CASES.md).

## Core workflow

```
1. resolve_chain / list_supported_chains  → discover networks
2. search_token / list_tokens_on_chain    → valid token addresses
3. convert_token_amount                   → human amounts → atomic strings
4. check_swap_feasibility (optional)      → balance + route check
5. get_swap_quote                         → best price (EXACT_INPUT)
6. [Show quote to user from API fields — get confirmation]
6b. get_quote_confirmation (recommended)  → user personal_sign before prepare
7. prepare_intent                         → lock quote, get signing payload
8. simulate_intent                        → optional pre-flight check
9. get_signing_instructions               → guide user to sign in wallet
10. submit_signed_intent                  → after user signs
11. get_intent_status                     → track until complete
```

Use MCP prompts `swap_workflow`, `bridge_workflow`, or `compare_and_swap_workflow` for step-by-step reminders.

## Critical rules

1. **Never invent token addresses.** Use `search_token`, `list_tokens_on_chain`, or `get_token_info`.
2. **Never ask for private keys or seed phrases.**
3. **Always get explicit user confirmation** before calling `prepare_intent`.
4. **Set `userConfirmed: true`** only after the user says yes.
5. **Quotes expire in 60 seconds.** Re-quote if expired.
6. **Default slippage is 300 bps (3%).** Max is 1000 bps (10%).
7. **Use `convert_token_amount`** when the user gives human amounts ("50 USDC", "0.5 ETH").
8. **Trust the wallet, not the chat.** Tell users to verify token addresses, amounts, chain, and settlement contract in their wallet UI — reject if it differs from the quote.
9. **Use wallet-signed confirmation when possible.** Call `get_quote_confirmation`, have the user sign with `personal_sign`, then pass `confirmationSignature` to `prepare_intent`.

## Platform security

For trust boundaries, MFA flows, provider trust models, and production checklists, see [SECURITY.md](./SECURITY.md).

Partner dashboard users with MFA enabled must complete an authenticator challenge after password or SSO login before accessing keys or trading settings.

## Discovery tools

### list_supported_chains

No inputs. Returns chain IDs, names, native symbols, explorer URLs, and L2 flag.

### resolve_chain

```
query: "Base"
```

Maps chain names or IDs to full chain metadata.

### search_token

```
chainId: 8453
query: "USDC"
```

Returns matching tokens with addresses and decimals.

### list_tokens_on_chain

```
chainId: 8453
```

Lists all curated tokens on a chain.

### get_token_info

```
chainId: 8453
address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
```

Returns token metadata and `allowlisted` status.

## Amount helpers (MCP-only)

### convert_token_amount

```
chainId: 8453
symbol: "USDC"
humanAmount: "50"
direction: "human_to_atomic"
```

Returns `atomicAmount` for use in `get_swap_quote`. Use `atomic_to_human` to display quotes.

### format_token_amount

```
atomicAmount: "50000000"
decimals: 6
symbol: "USDC"
```

Returns human-readable string for user display.

## Quote tools

### get_swap_quote (EXACT_INPUT)

User specifies **input** amount. Optional `executionMode`: `gasless` or `any` (default). For gasless swaps prefer **`get_gasless_swap_quote`** — do not use `executionMode: "gas"` (deprecated; often confused with gasless).

```
fromChain: 8453
toChain: 8453
tokenIn: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
tokenOut: "0x4200000000000000000000000000000000000006"
amount: "100000000"
slippageBps: 300
executionMode: "any"
```

### get_swap_quote_exact_output

User wants a specific **output** amount (e.g. "exactly 1 ETH"):

Same parameters; `amount` is the desired output in smallest units.

### compare_quotes

Same inputs as `get_swap_quote` plus optional `limit` (2–5).

### compare_slippage_quotes

Compare at `slippageBpsLow` (e.g. 100) vs `slippageBpsHigh` (e.g. 300).

### estimate_total_cost

Pass the `quote` object from `get_swap_quote` for a fee/gas summary. Gasless quotes show `executionMode: "gasless"` and `gasEstimateUsd: 0`.

### check_swap_feasibility

Combines route check, wallet balance, and optional live quote. Use before confirming with the user.

## Pre-trade checks

### check_route_support

```
fromChain: 42161
toChain: 8453
tokenIn: "..."
tokenOut: "..."
```

Returns whether the route is supported without a full quote.

### get_wallet_balances

```
walletAddress: "0x..."
chainId: 8453
tokenAddresses: ["0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"]
```

Native + ERC20 balances via RPC.

## MCP wallet model (important)

Intent MCP is **stateless** — the server never holds or connects to a user wallet. Every `walletAddress` in tool calls is **text the agent passes in** (from chat, a prior message, or `get_wallet_balances`). Uniswap quotes and Permit2 payloads are bound to whatever address was supplied at quote/prepare time.

There is **no** “connect wallet to the server.” Errors like “Click Connect Wallet…” are **incorrect for MCP** — ignore them.

**Canonical wallet after Permit2:** call `sync_permit_signer` or `submit_signed_intent`. The returned `permitSigner` is the real on-chain identity (recovered from the signature). Use that address for the gas swap tx step — not the `walletAddress` string from an earlier tool call if they differ.

**Best practice:** always run `get_quote_confirmation` → user `personal_sign` → `prepare_intent` with the **same** address and `confirmationSignature`. That proves consent from one address; Permit2 may still be signed by another account with token balance — the API auto-heals on submit.

## Intent execution

### get_quote_confirmation (recommended)

Obtain a `personal_sign` message tied to the quote. The user signs in their wallet to prove consent before `prepare_intent`.

```
quoteId: "q_abc123"
walletAddress: "0x..."
```

Returns `message`, `quoteCommitment`, and `expiresAt`. After the user signs with **personal_sign**, pass the signature as `confirmationSignature` to `prepare_intent`.

This is a **separate** signature from the Permit2 EIP-712 step later — do not submit this signature to `submit_signed_intent`.

When `REQUIRE_WALLET_CONFIRMATION=true` on the server, `confirmationSignature` is mandatory.

### prepare_intent

```
quoteId: "q_abc123"
userConfirmed: true
walletAddress: "0x..."
confirmationSignature: "0x..."   # from personal_sign on get_quote_confirmation message
```

**Only call after user explicitly confirms.** Show `quoteCommitment` from the quote response so users can cross-check before signing swap payloads in the wallet.

### simulate_intent / get_signing_instructions / sync_permit_signer / submit_signed_intent / get_intent_status

See core workflow above.

#### Permit2 wallet mismatch (Uniswap gas swaps)

If the user signed Permit2 from a **different MetaMask account** than `walletAddress` used in `prepare_intent`:

1. **Do NOT** ask for a fresh quote or tell them to switch MetaMask (yet).
2. Call **`sync_permit_signer`** with the Permit2 signature, **or** call **`submit_signed_intent`** directly.
3. The API returns `permitSigner` / `walletAddressCorrected: true` — use that address for the rest of the flow.
4. Only for the **gas swap transaction** (step 2) must the user switch MetaMask to `permitSigner`.

**Common cause (MCP):** the agent passed `walletAddress: 0xB6c9…` to `prepare_intent`, but the user signed Permit2 with a **different** local MetaMask account (`0x4e2C…`). The server did not “connect” either address — it only stores what the agent sent vs what the signature proves. Check `permitBoundWallet` in `get_signing_instructions` before signing; after signing, call `sync_permit_signer` — do **not** tell the user to reconnect a wallet to the server.

#### Token approval before Permit2 (Uniswap)

Some tokens require an on-chain **ERC20 approve** for Permit2 before the Permit2 EIP-712 signature. When `prepare_intent` returns `type: "transaction"` with `phase: "token_approval"`:

1. User signs and broadcasts the **approval transaction** (pays gas) — MetaMask prompt **(1) Confirm transaction**.
2. Submit **`txHash`** via `submit_signed_intent` (not the signature bytes).
3. API returns the next step: Permit2 EIP-712 — MetaMask prompt **(2) Sign typed data** (no gas).
4. Submit the **Permit2 signature** via `sync_permit_signer` or `submit_signed_intent`.
5. **Do NOT** re-quote because swap simulation failed before approval — that is expected.

**Three different wallet actions (do not mix them up):**

| Step | MetaMask type | Submit to API |
|------|---------------|---------------|
| Quote confirmation (optional) | `personal_sign` text message | `confirmationSignature` on `prepare_intent` only |
| ERC20 approve (if required) | On-chain **transaction** | `txHash` on `submit_signed_intent` |
| Permit2 | **Sign typed data** (EIP-712) | `signature` on `sync_permit_signer` / `submit_signed_intent` |

Approval and Permit2 should use the **same MetaMask account** (the one that holds USDC). Metalift’s “connected wallet” (`0xB6c9…`) is UI state — if it differs from the account that approved/signed, the frontend error is misleading; call `sync_permit_signer` and use returned `permitSigner`.

## Partner & account tools

### get_account_info

Returns API key tier, rate limits, org, and fee configuration.

### get_compliance_info

Platform fee disclosures and geo policy.

### get_usage_summary

```
days: 30
```

Quote/intent activity counts for this key.

### list_intents / list_trading_activity

Paginated intent history and audit log for debugging.

### list_b2b_tiers

B2B pricing tiers and compliance overview.

## Example — natural language swap

**User:** "Swap 50 USDC to ETH on Base"

1. `resolve_chain("Base")` → 8453
2. `search_token(8453, "USDC")` and `search_token(8453, "WETH")`
3. `convert_token_amount(8453, symbol: "USDC", humanAmount: "50", direction: human_to_atomic)`
4. `get_swap_quote(...)` with atomic amount
5. `format_token_amount` on output for display
6. User confirms → `prepare_intent` → `simulate_intent` → `get_signing_instructions` → sign → `submit_signed_intent` → `get_intent_status`

## Cross-chain example

```
fromChain: 1
toChain: 8453
tokenIn: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"
tokenOut: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
amount: "1000000000"
```

Use `bridge_workflow` prompt. Cross-chain routes use ERC-7683 or UniswapX automatically.

## Gas vs gasless

| User intent | MCP action |
|-------------|------------|
| Default swap | `executionMode: "any"` — router picks best net outcome |
| "I have no ETH for gas" / gasless | **`get_gasless_swap_quote`** (or `executionMode: "gasless"`) |
| "Cheapest including gas" | `executionMode: "any"` — confirm `quote.executionMode === "gas"`, then `prepare_intent` with `acknowledgeUserPaidGas: true` |
| "Compare gasless options" | `compare_quotes` with `executionMode: "gasless"`, `limit: 3` |

Gasless same-chain providers: UniswapX, 0x (Gasless API), CoW Swap, 1inch Fusion (all require `INTEGRATOR_FEE_RECIPIENT`). For **0x**, some tokens (e.g. USDT) require two signatures: gasless approval, then trade — call `submit_signed_intent` after each signature. For **1inch Fusion**, sign the exact EIP-712 payload from `get_signing_instructions` and submit promptly — if you see `invalid signature`, get a fresh quote and run `prepare_intent` again (quotes expire in ~60s). Gas routes use Uniswap CLASSIC and **LI.FI** (same-chain + cross-chain bridges/swaps). Cross-chain also includes Uniswap BRIDGE (`erc7683`). Prefer default `executionMode: "any"` so LI.FI competes with other providers on bridges.

## Error handling

| Error | Action |
|-------|--------|
| `USER_PAID_GAS_REQUIRED` | Wrong quote for gasless — use `gaslessAlternative` from the response, or call `get_gasless_swap_quote`; do not pass `acknowledgeUserPaidGas` unless user agreed to pay gas |
| `INVALID_EXECUTION_MODE` | Never use `executionMode: "gas"` — use `gasless` or `any` |
| `QUOTE_EXPIRED` | Call `get_swap_quote` again |
| `VALIDATION_ERROR` | Check tokens via `search_token` / `get_token_info` |
| `RATE_LIMIT` | Wait and retry; check `get_account_info` tier |
| `SIMULATION_FAILED` | Do not proceed — inform user |
| Token not in allowlist | Use `list_tokens_on_chain` |
| `BALANCE_ERROR` | RPC not configured for chain |

## Amount conversion reference

| Token | Decimals | 1 unit amount string |
|-------|----------|---------------------|
| ETH/WETH | 18 | `"1000000000000000000"` |
| USDC | 6 | `"1000000"` |
| USDT | 6 | `"1000000"` |
| DAI | 18 | `"1000000000000000000"` |

Prefer `convert_token_amount` over manual math.

## Using with pokt-mcp

**Division of responsibility:**

| Server | Scope |
|--------|-------|
| **pokt-mcp** (this repo) | Balances, blocks, gas, RPC reads, native sends via `pocket_query` |
| **Intent MCP** (third-party) | Swap execution, cross-chain intents, signing flow |

For swap **execution**, use Intent MCP exclusively — do not use pokt-mcp's `pocket_rpc_call` or `wallet_send_transaction` for swaps.

See also: [USE_CASES.md](USE_CASES.md) (pokt-mcp capabilities) and [USE_CASES.md#third-party-mcp-integrations-optional](USE_CASES.md#third-party-mcp-integrations-optional).
