import { resolveChain } from "@pokt-mcp/pocket-client";
import type { NlParseResult, NlRpcEngine, RpcIntent, SessionContext } from "./types.js";
import { matchTemplate } from "./templates/index.js";

const CHAIN_PATTERN =
  /\b(on|for)\s+(ethereum|eth|mainnet|base|polygon|poly|matic|arbitrum|arb|optimism|opt|avalanche|avax|solana|sol|gnosis)\b/i;

const ADDRESS_PATTERN = /(0x[a-fA-F0-9]{40}|[a-zA-Z0-9-]+\.eth)/;

function inferChain(query: string, context?: SessionContext): string {
  const match = query.match(CHAIN_PATTERN);
  if (match) {
    const resolved = resolveChain(match[2]);
    if (resolved) return resolved.slug;
  }
  return context?.defaultChain ?? "eth";
}

function buildBalanceIntent(chain: string, address: string): RpcIntent {
  return {
    action: "read",
    chain,
    method: "eth_getBalance",
    params: [address, "latest"],
    humanSummary: `Get native balance for ${address} on ${chain}`,
    riskLevel: "none",
  };
}

function buildBlockIntent(chain: string): RpcIntent {
  return {
    action: "read",
    chain,
    method: "eth_blockNumber",
    params: [],
    humanSummary: `Get latest block number on ${chain}`,
    riskLevel: "none",
  };
}

function buildSendIntent(chain: string, to: string, valueWei: string): RpcIntent {
  return {
    action: "write",
    chain,
    method: "eth_sendTransaction",
    params: [{ to, value: valueWei }],
    humanSummary: `Send native tokens to ${to} on ${chain}`,
    riskLevel: "high",
  };
}

export function createNlRpcEngine(): NlRpcEngine {
  return {
    async parse(query, context) {
      const chain = inferChain(query, context);
      const normalized = query.trim().toLowerCase();

      const templateResult = matchTemplate(query, chain);
      if (templateResult) {
        return wrapIntent(templateResult);
      }

      if (/latest block|block number|current block/.test(normalized)) {
        return wrapIntent(buildBlockIntent(chain));
      }

      if (/balance/.test(normalized)) {
        const addrMatch = query.match(ADDRESS_PATTERN);
        if (addrMatch) {
          return wrapIntent(buildBalanceIntent(chain, addrMatch[1]));
        }
      }

      const sendMatch = query.match(
        /send\s+([\d.]+)\s*(eth|matic|avax|sol)?\s*(?:to\s+)?(0x[a-fA-F0-9]{40})/i,
      );
      if (sendMatch) {
        const amount = parseFloat(sendMatch[1]);
        const to = sendMatch[3];
        const valueWei = `0x${BigInt(Math.floor(amount * 1e18)).toString(16)}`;
        return wrapIntent(buildSendIntent(chain, to, valueWei), true);
      }

      throw new Error(
        `NL_PARSE_FAILED: could not parse query. Use pocket_rpc_call with explicit method/params.`,
      );
    },

    explain(method, params, chain) {
      return `Would call ${method} on chain "${chain}" with params: ${JSON.stringify(params)}`;
    },
  };
}

function wrapIntent(intent: RpcIntent, forceConfirm = false): NlParseResult {
  const isWrite = intent.action === "write" || intent.riskLevel === "high";
  return {
    intent,
    pendingAction: isWrite ? "wallet_send_transaction" : undefined,
    requiresConfirmation: isWrite || forceConfirm,
  };
}

export * from "./types.js";
