# MCP Tool Reference

Complete tool catalog for the Pocket MCP server. All tools follow MCP JSON Schema conventions.

---

## Discovery

### `pocket_list_chains`

List all chains available via Pocket portal.

**Input:** none

**Output:**

```json
{
  "chains": [
    {
      "slug": "eth",
      "name": "Ethereum Mainnet",
      "chainId": 1,
      "nativeSymbol": "ETH",
      "protocol": "evm",
      "endpoint": "https://eth.api.pocket.network"
    }
  ]
}
```

---

### `pocket_get_chain`

Get metadata for a single chain by slug or alias.

**Input:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `chain` | string | yes | Slug or alias (`eth`, `ethereum`, `1`) |

---

### `pocket_list_methods`

List commonly used RPC methods for a chain's protocol.

**Input:**

| Field | Type | Required |
|-------|------|----------|
| `chain` | string | yes |

**Output:** `{ protocol: "evm", methods: ["eth_blockNumber", "eth_getBalance", ...] }`

---

## Curated Read Tools

### `pocket_get_balance`

**Input:**

| Field | Type | Required |
|-------|------|----------|
| `chain` | string | yes |
| `address` | string | yes |
| `block` | string | no — default `"latest"` |

**Output:** `{ address, balanceWei, balanceFormatted, symbol }`

---

### `pocket_get_block_number`

**Input:** `{ chain: string }`

**Output:** `{ blockNumber: number, blockHex: string }`

---

### `pocket_get_transaction`

**Input:**

| Field | Type | Required |
|-------|------|----------|
| `chain` | string | yes |
| `hash` | string | yes |

---

### `pocket_get_receipt`

**Input:** `{ chain, hash }`

**Output:** Standard transaction receipt fields.

---

### `pocket_call_contract`

Execute a read-only contract call (`eth_call`).

**Input:**

| Field | Type | Required |
|-------|------|----------|
| `chain` | string | yes |
| `to` | string | yes — contract address |
| `data` | string | yes — calldata hex |
| `from` | string | no |
| `block` | string | no |

---

### `pocket_get_logs`

**Input:**

| Field | Type | Required |
|-------|------|----------|
| `chain` | string | yes |
| `address` | string | no |
| `topics` | string[] | no |
| `fromBlock` | string | yes |
| `toBlock` | string | yes |

---

### `pocket_estimate_gas`

**Input:**

| Field | Type | Required |
|-------|------|----------|
| `chain` | string | yes |
| `from` | string | no |
| `to` | string | yes |
| `value` | string | no — wei hex |
| `data` | string | no |

---

## Full RPC Access

### `pocket_rpc_call`

Execute any JSON-RPC method on a Pocket chain. Primary escape hatch for full RPC coverage.

**Input:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `chain` | string | yes | Chain slug |
| `method` | string | yes | JSON-RPC method name |
| `params` | array | no | Method parameters |

**Example:**

```json
{
  "chain": "eth",
  "method": "eth_getBlockByNumber",
  "params": ["latest", false]
}
```

**Output:**

```json
{
  "result": { "...": "raw JSON-RPC result" },
  "meta": { "chain": "eth", "method": "eth_getBlockByNumber", "latencyMs": 142 }
}
```

---

### `pocket_batch_rpc`

Execute multiple JSON-RPC calls in one HTTP request.

**Input:**

| Field | Type | Required |
|-------|------|----------|
| `chain` | string | yes |
| `calls` | `{ method, params }[]` | yes |

**Policy:** Write methods (`eth_sendRawTransaction`, etc.) rejected in batch — use dedicated wallet tools.

---

## Natural Language

### `pocket_query_nl`

Parse natural language and execute (read) or prepare (write) a chain query.

**Input:**

| Field | Type | Required |
|-------|------|----------|
| `query` | string | yes |
| `chain` | string | no — inferred if omitted |
| `autoExecute` | boolean | no — default `true` for reads |

**Read example:**

Input: `{ "query": "What is the latest block on Base?" }`

Output:

```json
{
  "intent": {
    "action": "read",
    "chain": "base",
    "method": "eth_blockNumber",
    "humanSummary": "Get latest block number on Base"
  },
  "result": { "blockNumber": 12345678 }
}
```

**Write example:**

Input: `{ "query": "Send 0.01 ETH to 0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb", "autoExecute": false }`

Output:

```json
{
  "intent": {
    "action": "write",
    "chain": "eth",
    "riskLevel": "high",
    "humanSummary": "Send 0.01 ETH to 0x742d...0bEb on Ethereum"
  },
  "pendingAction": "wallet_send_transaction",
  "txPreview": {
    "to": "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb",
    "value": "10000000000000000",
    "estimatedGas": "21000"
  },
  "requiresConfirmation": true
}
```

---

### `pocket_explain_rpc`

Explain what an RPC call would do without executing it.

**Input:** `{ chain, method, params }`

**Output:** `{ explanation: string, riskLevel: string }`

---

## Transaction Lifecycle

### `pocket_get_nonce`

**Input:** `{ chain, address, block? }`

**Output:** `{ nonce: number }`

---

### `pocket_wait_for_receipt`

Poll for transaction confirmation.

**Input:**

| Field | Type | Required |
|-------|------|----------|
| `chain` | string | yes |
| `hash` | string | yes |
| `timeoutMs` | number | no — default 120000 |
| `pollIntervalMs` | number | no — default 2000 |

**Output:** `{ status: "success" | "reverted" | "timeout", receipt?: {...} }`

---

## Wallet Tools

### `wallet_get_status`

**Input:** none

**Output:**

```json
{
  "connected": true,
  "address": "0x...",
  "chainId": 1,
  "chainSlug": "eth",
  "connectionType": "walletconnect" | "injected" | "none"
}
```

---

### `wallet_connect`

Initiate wallet connection. Returns WalletConnect URI for QR display.

**Input:**

| Field | Type | Required |
|-------|------|----------|
| `mode` | `"walletconnect"` \| `"injected"` | no — default `"walletconnect"` |

**Output:** `{ uri?: string, connected: boolean, address?: string }`

---

### `wallet_disconnect`

**Input:** none

---

### `wallet_switch_chain`

**Input:** `{ chain: string }` — slug or chainId

---

### `wallet_sign_message`

**Input:**

| Field | Type | Required |
|-------|------|----------|
| `message` | string | yes |

**Output:** `{ signature: string }`

---

### `wallet_send_transaction`

Build, optionally confirm, sign, and broadcast a transaction.

**Input:**

| Field | Type | Required |
|-------|------|----------|
| `chain` | string | yes |
| `to` | string | yes |
| `value` | string | no — wei decimal or hex |
| `data` | string | no |
| `gas` | string | no — auto-estimate if omitted |
| `confirm` | boolean | yes — must be `true` to broadcast |

**Flow:**

1. `confirm: false` → returns `txPreview` only
2. `confirm: true` → prompts wallet, broadcasts, returns `txHash`

**Output:**

```json
{
  "txHash": "0x...",
  "status": "submitted",
  "explorerUrl": "https://etherscan.io/tx/0x..."
}
```

---

### `wallet_send_raw_transaction`

Broadcast a pre-signed raw transaction.

**Input:** `{ chain, rawTransaction: string }`

**Policy:** Requires `confirm: true`. Used when wallet signs externally.

---

## MCP Resources (optional)

| URI | Description |
|-----|-------------|
| `pocket://chains` | Full chain registry JSON |
| `pocket://methods/{protocol}` | Method reference per protocol |
| `pocket://session` | Current wallet + default chain context |

---

## MCP Prompts (optional)

| Prompt | Description |
|--------|-------------|
| `analyze-wallet` | Template for portfolio analysis across chains |
| `explain-tx` | Template for transaction receipt explanation |
| `build-contract-call` | Guided ABI encoding for `eth_call` |
