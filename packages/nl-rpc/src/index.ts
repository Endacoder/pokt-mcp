import { listChains, resolveChain } from "@pokt-mcp/pocket-client";
import type { RpcIntent, SessionContext } from "@pokt-mcp/shared";
import type { NlParseResult, NlRpcEngine } from "./types.js";
import { matchTemplate } from "./templates/index.js";

const CHAIN_PATTERN =
  /\b(on|for)\s+(ethereum|eth|mainnet|base|polygon|poly|matic|arbitrum|arb|optimism|opt|avalanche|avax|solana|sol|gnosis|bsc|linea|scroll|blast|mantle|celo|fantom|bera|zksync)\b/i;

const ADDRESS_PATTERN = /(0x[a-fA-F0-9]{40}|[a-zA-Z0-9-]+\.eth)/;
const TX_HASH_PATTERN = /(0x[a-fA-F0-9]{64})/;
const BLOCK_NUM_PATTERN = /block\s+(?:#?(\d+)|number\s+(\d+))/i;

function inferChain(query: string, context?: SessionContext): string {
  const match = query.match(CHAIN_PATTERN);
  if (match) {
    const resolved = resolveChain(match[2]);
    if (resolved) return resolved.slug;
  }
  return context?.defaultChain ?? "eth";
}

function wrapIntent(intent: RpcIntent, forceConfirm = false): NlParseResult {
  const isWrite = intent.action === "write" || intent.riskLevel === "high";
  return {
    intent,
    pendingAction: isWrite ? "wallet_send_transaction" : undefined,
    requiresConfirmation: isWrite || forceConfirm,
  };
}

export function createNlRpcEngine(): NlRpcEngine {
  return {
    async parse(query: string, context?: SessionContext): Promise<NlParseResult> {
      const chain = inferChain(query, context);
      const normalized = query.trim().toLowerCase();

      if (/list chains|available chains|supported chains/.test(normalized)) {
        return wrapIntent({
          action: "read",
          chain,
          method: "__list_chains__",
          params: [],
          humanSummary: "List available Pocket chains",
          riskLevel: "none",
        });
      }

      const templateResult = matchTemplate(query, chain);
      if (templateResult) return wrapIntent(templateResult);

      const blockMatch = query.match(BLOCK_NUM_PATTERN);
      if (blockMatch) {
        const blockNum = blockMatch[1] ?? blockMatch[2];
        return wrapIntent({
          action: "read",
          chain,
          method: "eth_getBlockByNumber",
          params: [`0x${Number(blockNum).toString(16)}`, false],
          humanSummary: `Get block ${blockNum} on ${chain}`,
          riskLevel: "none",
        });
      }

      if (/latest block|current block/.test(normalized) && !BLOCK_NUM_PATTERN.test(query)) {
        return wrapIntent({
          action: "read",
          chain,
          method: "eth_blockNumber",
          params: [],
          humanSummary: `Get latest block number on ${chain}`,
          riskLevel: "none",
        });
      }

      if (/balance/.test(normalized)) {
        const addrMatch = query.match(ADDRESS_PATTERN);
        if (addrMatch) {
          const address = addrMatch[1];
          if (address.endsWith(".eth")) {
            return wrapIntent({
              action: "read",
              chain: "eth",
              method: "__ens_balance__",
              params: [address],
              humanSummary: `Resolve ENS and get balance for ${address}`,
              riskLevel: "none",
            });
          }
          return wrapIntent({
            action: "read",
            chain,
            method: "eth_getBalance",
            params: [address, "latest"],
            humanSummary: `Get native balance for ${address} on ${chain}`,
            riskLevel: "none",
          });
        }
      }

      const receiptMatch = query.match(/receipt\s+(0x[a-fA-F0-9]{64})/i);
      if (receiptMatch) {
        return wrapIntent({
          action: "read",
          chain,
          method: "eth_getTransactionReceipt",
          params: [receiptMatch[1]],
          humanSummary: `Get receipt for ${receiptMatch[1]}`,
          riskLevel: "none",
        });
      }

      const txMatch = query.match(/transaction\s+(0x[a-fA-F0-9]{64})/i) ?? query.match(TX_HASH_PATTERN);
      if (txMatch && /transaction|tx|hash/.test(normalized)) {
        return wrapIntent({
          action: "read",
          chain,
          method: "eth_getTransactionByHash",
          params: [txMatch[1] ?? txMatch[0]],
          humanSummary: `Get transaction details`,
          riskLevel: "none",
        });
      }

      const sendMatch = query.match(
        /send\s+([\d.]+)\s*(?:eth|matic|avax|bnb|bera|xdai|ftm)?\s*(?:to\s+)?(0x[a-fA-F0-9]{40})/i,
      );
      if (sendMatch) {
        const amount = parseFloat(sendMatch[1]);
        const to = sendMatch[2];
        const valueWei = `0x${BigInt(Math.floor(amount * 1e18)).toString(16)}`;
        return wrapIntent(
          {
            action: "write",
            chain,
            method: "eth_sendTransaction",
            params: [{ to, value: valueWei }],
            humanSummary: `Send ${amount} native tokens to ${to} on ${chain}`,
            riskLevel: "high",
          },
          true,
        );
      }

      throw new Error(
        "NL_PARSE_FAILED: could not parse query. Use pocket_rpc_call with explicit method/params.",
      );
    },

    explain(method: string, params: unknown[], chain: string) {
      if (method === "__list_chains__") return `Would list Pocket chains`;
      if (method === "__ens_balance__") return `Would resolve ENS ${params[0]} and fetch balance on eth`;
      return `Would call ${method} on chain "${chain}" with params: ${JSON.stringify(params)}`;
    },
  };
}

export async function executeIntent(
  pocket: import("@pokt-mcp/pocket-client").PocketClient,
  intent: RpcIntent,
): Promise<unknown> {
  if (intent.method === "__list_chains__") {
    return { chains: listChains() };
  }
  if (intent.method === "__ens_balance__") {
    const name = intent.params[0] as string;
    return {
      note: "ENS resolution requires eth chain eth_call — use pocket_call_contract in advanced mode",
      ens: name,
      chain: "eth",
    };
  }
  const resp = await pocket.rpc(intent.chain, intent.method, intent.params);
  return { result: resp.result, meta: resp.meta };
}

export * from "./types.js";
