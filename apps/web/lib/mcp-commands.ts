export type McpCommandCategory =
  | "primary"
  | "discovery"
  | "reads"
  | "features"
  | "security"
  | "wallet"
  | "rpc"
  | "agent";

export type McpCommand = {
  id: string;
  tool: string;
  label: string;
  description: string;
  category: McpCommandCategory;
  example: string;
  /** Example when a wallet is connected (handle-only send / defaults). */
  walletExample?: string;
  requiresWallet?: boolean;
};

export type McpCommandContext = {
  walletAddress?: string;
  chain?: string;
};

/** Demo address used in static examples — replaced when wallet is connected. */
export const MCP_EXAMPLE_ADDRESS = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";

const CHAIN_SLUG_LABEL: Record<string, string> = {
  eth: "Ethereum",
  base: "Base",
  "arb-one": "Arbitrum",
  poly: "Polygon",
  opt: "Optimism",
  avax: "Avalanche",
};

export const MCP_COMMAND_CATEGORIES: Record<McpCommandCategory, string> = {
  primary: "Primary",
  discovery: "Discovery",
  reads: "Chain reads",
  features: "Feature suite",
  security: "Security & audit",
  wallet: "Wallet",
  rpc: "Raw RPC",
  agent: "Agent",
};

export const MCP_COMMANDS: McpCommand[] = [
  {
    id: "pocket_query",
    tool: "pocket_query",
    label: "Natural language query",
    description: "Primary entry — routes templates, LLM, and agent",
    category: "primary",
    example: "Latest block on Base",
    walletExample: "What is my wallet balance?",
  },
  {
    id: "pocket_agent_query",
    tool: "pocket_agent_query",
    label: "Multi-step agent",
    description: "Explicit agent loop for complex research",
    category: "agent",
    example: "Analyze USDC transfer activity for vitalik.eth on Ethereum",
    walletExample: "Audit my account",
  },
  {
    id: "pocket_list_chains",
    tool: "pocket_list_chains",
    label: "List Pocket chains",
    description: "All networks available via Pocket portal",
    category: "discovery",
    example: "List all Pocket chains",
  },
  {
    id: "pocket_get_chain",
    tool: "pocket_get_chain",
    label: "Chain metadata",
    description: "Slug, chain ID, native symbol, endpoint",
    category: "discovery",
    example: "What is chain ID for Polygon?",
  },
  {
    id: "pocket_list_methods",
    tool: "pocket_list_methods",
    label: "RPC methods",
    description: "Common methods for a chain protocol",
    category: "discovery",
    example: "What RPC methods does Base support?",
  },
  {
    id: "pocket_get_balance",
    tool: "pocket_get_balance",
    label: "Native balance",
    description: "ETH/native balance for an address",
    category: "reads",
    example: "Balance of 0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045 on eth",
    walletExample: "What is my wallet balance?",
  },
  {
    id: "pocket_get_block_number",
    tool: "pocket_get_block_number",
    label: "Latest block",
    description: "Current block number on a chain",
    category: "reads",
    example: "Latest block on Ethereum",
  },
  {
    id: "pocket_get_transaction",
    tool: "pocket_get_transaction",
    label: "Transaction by hash",
    description: "Full transaction details",
    category: "reads",
    example: "Transaction 0x5c504ed432cb51138bcf09aa5e8a410dd4a1e204ef84bfed1be16dfba1b22060 on eth",
  },
  {
    id: "pocket_get_receipt",
    tool: "pocket_get_receipt",
    label: "Transaction receipt",
    description: "Status, gas used, logs",
    category: "reads",
    example: "Receipt for 0x5c504ed432cb51138bcf09aa5e8a410dd4a1e204ef84bfed1be16dfba1b22060",
  },
  {
    id: "pocket_get_token_balance",
    tool: "pocket_get_token_balance",
    label: "ERC-20 balance",
    description: "Token balance for known symbols or contract",
    category: "reads",
    example: "USDC balance of 0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045 on base",
  },
  {
    id: "pocket_call_contract",
    tool: "pocket_call_contract",
    label: "Contract read (eth_call)",
    description: "Read-only contract call with calldata",
    category: "reads",
    example: "Call balanceOf on USDC for 0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045 on eth",
  },
  {
    id: "pocket_get_logs",
    tool: "pocket_get_logs",
    label: "Event logs",
    description: "Filtered eth_getLogs",
    category: "reads",
    example: "Recent USDC transfers for 0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045 on eth",
  },
  {
    id: "pocket_estimate_gas",
    tool: "pocket_estimate_gas",
    label: "Estimate gas",
    description: "Gas estimate for a transaction",
    category: "reads",
    example: "Cost to send 0.1 ETH on Ethereum",
  },
  {
    id: "pocket_get_nonce",
    tool: "pocket_get_nonce",
    label: "Account nonce",
    description: "Transaction count for an address",
    category: "reads",
    example: "Nonce for 0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045 on eth",
  },
  {
    id: "pocket_wait_for_receipt",
    tool: "pocket_wait_for_receipt",
    label: "Wait for receipt",
    description: "Poll until transaction confirms",
    category: "reads",
    example: "Wait for receipt 0x5c504ed432cb51138bcf09aa5e8a410dd4a1e204ef84bfed1be16dfba1b22060",
  },
  {
    id: "pocket_wallet_health",
    tool: "pocket_wallet_health",
    label: "Wallet health check",
    description: "Score, gas spent, portfolio, approvals",
    category: "features",
    example: "Wallet health for 0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
    walletExample: "Wallet health check for my wallet",
  },
  {
    id: "pocket_research_token",
    tool: "pocket_research_token",
    label: "Token research",
    description: "Price, volume, holders, safety preview",
    category: "features",
    example: "Research USDC on Ethereum",
  },
  {
    id: "pocket_explain_contract",
    tool: "pocket_explain_contract",
    label: "Explain contract",
    description: "ABI, proxy detection, suspicious patterns",
    category: "features",
    example: "Explain contract 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48 on eth",
  },
  {
    id: "pocket_governance_query",
    tool: "pocket_governance_query",
    label: "DAO governance",
    description: "Snapshot proposals, votes, whales",
    category: "features",
    example: "Active UNI governance proposals",
  },
  {
    id: "pocket_scan_address",
    tool: "pocket_scan_address",
    label: "Scam / rug scan",
    description: "Honeypot, reputation, approval risks",
    category: "features",
    example: "Is 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48 a scam?",
  },
  {
    id: "pocket_defi_positions",
    tool: "pocket_defi_positions",
    label: "DeFi positions",
    description: "TVL, Aave health factor, liquidation risk",
    category: "features",
    example: "DeFi positions for 0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
    walletExample: "DeFi positions for my wallet",
    requiresWallet: true,
  },
  {
    id: "pocket_operator_status",
    tool: "pocket_operator_status",
    label: "Node operator dashboard",
    description: "Supplier status, relays, mining difficulty",
    category: "features",
    example: "Pocket node operator status",
  },
  {
    id: "pocket_audit_account",
    tool: "pocket_audit_account",
    label: "Account security audit",
    description: "Multi-chain approvals and portfolio",
    category: "security",
    example: "Audit account 0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
    walletExample: "Audit my account",
  },
  {
    id: "pocket_query_nl",
    tool: "pocket_query_nl",
    label: "NL parse only",
    description: "Parse natural language to RpcIntent without executing",
    category: "agent",
    example: "Parse: gas price on Base",
  },
  {
    id: "pocket_explain_rpc",
    tool: "pocket_explain_rpc",
    label: "Explain RPC method",
    description: "Describe what an RPC method does",
    category: "agent",
    example: "Explain eth_getLogs",
  },
  {
    id: "pocket_rpc_call",
    tool: "pocket_rpc_call",
    label: "Raw RPC call",
    description: "Direct JSON-RPC when method is known",
    category: "rpc",
    example: "eth_syncing on eth",
  },
  {
    id: "pocket_batch_rpc",
    tool: "pocket_batch_rpc",
    label: "Batch RPC",
    description: "Multiple RPC calls in one request",
    category: "rpc",
    example: "Compare balance on eth, base, and arb for 0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
  },
  {
    id: "wallet_get_status",
    tool: "wallet_get_status",
    label: "Wallet status",
    description: "Connected address and chain",
    category: "wallet",
    example: "What is my wallet balance?",
    requiresWallet: true,
  },
  {
    id: "wallet_connect",
    tool: "wallet_connect",
    label: "Connect wallet",
    description: "Injected MetaMask provider",
    category: "wallet",
    example: "Connect my wallet",
  },
  {
    id: "wallet_disconnect",
    tool: "wallet_disconnect",
    label: "Disconnect wallet",
    description: "End wallet session",
    category: "wallet",
    example: "Disconnect wallet",
    requiresWallet: true,
  },
  {
    id: "wallet_switch_chain",
    tool: "wallet_switch_chain",
    label: "Switch chain",
    description: "Change active wallet network",
    category: "wallet",
    example: "Switch wallet to Base",
    requiresWallet: true,
  },
  {
    id: "wallet_sign_message",
    tool: "wallet_sign_message",
    label: "Sign message",
    description: "EIP-191 message signing",
    category: "wallet",
    example: "Sign message: hello pokt",
    requiresWallet: true,
  },
  {
    id: "wallet_send_transaction",
    tool: "wallet_send_transaction",
    label: "Send transaction",
    description: "Preview and broadcast native transfer",
    category: "wallet",
    example: "Send 0.001 ETH to 0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
    requiresWallet: true,
  },
  {
    id: "wallet_send_raw_transaction",
    tool: "wallet_send_raw_transaction",
    label: "Broadcast raw tx",
    description: "Submit pre-signed transaction",
    category: "wallet",
    example: "Broadcast raw transaction on eth",
    requiresWallet: true,
  },
];

export function commandHandle(tool: string): string {
  return `@${tool} `;
}

function chainLabel(slug: string): string {
  return CHAIN_SLUG_LABEL[slug] ?? slug;
}

/** Example prompt for a command, personalized when wallet is connected. */
export function resolveCommandExample(cmd: McpCommand, context?: McpCommandContext): string {
  if (!context?.walletAddress) return cmd.example;

  if (cmd.walletExample) return cmd.walletExample;

  const chain = context.chain ?? "eth";
  const chainName = chainLabel(chain);
  const { walletAddress } = context;

  if (cmd.tool === "pocket_get_token_balance") {
    return `USDC balance of ${walletAddress} on ${chain}`;
  }

  if (cmd.tool === "pocket_get_balance") {
    return `Balance of ${walletAddress} on ${chain}`;
  }

  if (cmd.tool === "pocket_get_nonce") {
    return `Nonce for ${walletAddress} on ${chain}`;
  }

  if (cmd.tool === "pocket_batch_rpc") {
    return `Compare balance on eth, base, and arb for ${walletAddress}`;
  }

  if (cmd.tool === "pocket_estimate_gas") {
    return `Cost to send 0.01 ETH on ${chainName}`;
  }

  if (cmd.example.includes(MCP_EXAMPLE_ADDRESS)) {
    return cmd.example
      .replaceAll(MCP_EXAMPLE_ADDRESS, walletAddress)
      .replace(/\bon eth\b/i, `on ${chain}`);
  }

  return cmd.example;
}

/** Strip leading @tool handle; returns user-authored body (may be empty). */
export function stripCommandHandle(text: string): string {
  const match = text.match(/^@[\w]+\s+(.*)$/);
  return match ? match[1].trim() : text.trim();
}

/** True when input is only an @handle with no trailing content. */
export function isHandleOnly(text: string): boolean {
  return /^@[\w]+\s*$/.test(text.trim());
}

/** Resolve chat text: strip @handle prefix; if body empty use command example. */
export function resolveChatMessage(
  text: string,
  options?: { commands?: McpCommand[]; context?: McpCommandContext },
): string {
  const commands = options?.commands ?? MCP_COMMANDS;
  const trimmed = text.trim();
  const match = trimmed.match(/^@([\w]+)\s*(.*)$/);
  if (!match) return trimmed;

  const [, tool, body] = match;
  const rest = body.trim();
  if (rest) return rest;

  const cmd = commands.find((c) => c.tool === tool);
  return cmd ? resolveCommandExample(cmd, options?.context) : trimmed;
}

export function hasSendableContent(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (isHandleOnly(trimmed)) return true;
  return stripCommandHandle(trimmed).length > 0 || !trimmed.startsWith("@");
}

export function filterMcpCommands(
  query: string,
  options?: { walletConnected?: boolean; chain?: string },
): McpCommand[] {
  const q = query.trim().toLowerCase();
  let list = MCP_COMMANDS;
  if (!options?.walletConnected) {
    list = list.filter((c) => !c.requiresWallet);
  }
  if (!q) return list;
  return list.filter((c) => {
    const example = resolveCommandExample(c, {
      walletAddress: options?.walletConnected ? "0xconnected" : undefined,
      chain: options?.chain,
    });
    return (
      c.tool.includes(q) ||
      c.label.toLowerCase().includes(q) ||
      c.description.toLowerCase().includes(q) ||
      c.example.toLowerCase().includes(q) ||
      example.toLowerCase().includes(q) ||
      MCP_COMMAND_CATEGORIES[c.category].toLowerCase().includes(q)
    );
  });
}

export function groupCommandsByCategory(commands: McpCommand[]): Array<[McpCommandCategory, McpCommand[]]> {
  const order: McpCommandCategory[] = [
    "primary",
    "features",
    "discovery",
    "reads",
    "security",
    "wallet",
    "rpc",
    "agent",
  ];
  const map = new Map<McpCommandCategory, McpCommand[]>();
  for (const cmd of commands) {
    const bucket = map.get(cmd.category) ?? [];
    bucket.push(cmd);
    map.set(cmd.category, bucket);
  }
  return order.filter((cat) => map.has(cat)).map((cat) => [cat, map.get(cat)!]);
}
