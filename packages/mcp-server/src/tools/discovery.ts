import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ChainInfo } from "@pokt-mcp/pocket-client";
import { z } from "zod";
import { asToolServer, chainNotFound, textResult } from "./helpers.js";

interface DiscoveryDeps {
  listChains: () => ChainInfo[];
  resolveChain: (alias: string) => ChainInfo | undefined;
}

const EVM_METHODS = [
  "eth_chainId",
  "eth_blockNumber",
  "eth_getBalance",
  "eth_getTransactionCount",
  "eth_getCode",
  "eth_call",
  "eth_estimateGas",
  "eth_gasPrice",
  "eth_getTransactionByHash",
  "eth_getTransactionReceipt",
  "eth_getLogs",
  "eth_getBlockByNumber",
  "eth_getBlockByHash",
  "eth_feeHistory",
  "eth_sendRawTransaction",
];

export function registerDiscoveryTools(server: McpServer, deps: DiscoveryDeps) {
  const s = asToolServer(server);
  s.tool(
    "pocket_list_chains",
    "List all blockchain networks available via Pocket Network portal",
    {},
    async () => textResult({ chains: deps.listChains() }),
  );

  s.tool(
    "pocket_get_chain",
    "Get metadata for a single chain by slug or alias",
    { chain: z.string().describe("Chain slug or alias (e.g. eth, polygon, 137)") },
    async ({ chain }) => {
      const info = deps.resolveChain(chain);
      if (!info) return chainNotFound(chain);
      return textResult(info);
    },
  );

  s.tool(
    "pocket_list_methods",
    "List common RPC methods for a chain's protocol",
    { chain: z.string() },
    async ({ chain }) => {
      const info = deps.resolveChain(chain);
      if (!info) return chainNotFound(chain);

      const methods =
        info.protocol === "evm"
          ? EVM_METHODS
          : info.protocol === "solana"
            ? ["getBalance", "getAccountInfo", "getTransaction", "getLatestBlockhash", "sendTransaction"]
            : ["status", "block", "tx"];

      return textResult({ protocol: info.protocol, methods });
    },
  );
}
