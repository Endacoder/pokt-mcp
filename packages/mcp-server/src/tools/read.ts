import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ChainInfo, PocketClient } from "@pokt-mcp/pocket-client";
import { z } from "zod";
import { getErc20TokenBalance, enrichTxLookupOutput } from "@pokt-mcp/nl-rpc";
import { asToolServer, chainNotFound, textResult } from "./helpers.js";

interface ReadToolDeps {
  pocket: PocketClient;
  resolveChain: (alias: string) => ChainInfo | undefined;
}

export function registerReadTools(server: McpServer, deps: ReadToolDeps) {
  const s = asToolServer(server);
  s.tool(
    "pocket_get_balance",
    "Shortcut: get native balance when you have chain + address. Prefer pocket_query for natural language.",
    {
      chain: z.string(),
      address: z.string(),
      block: z.string().optional().default("latest"),
    },
    async ({ chain, address, block }) => {
      const info = deps.resolveChain(chain);
      if (!info) return chainNotFound(chain);

      const resp = await deps.pocket.rpc<string>(info.slug, "eth_getBalance", [address, block]);
      const wei = BigInt(resp.result);
      return textResult({
        address,
        balanceWei: wei.toString(),
        balanceHex: resp.result,
        balanceFormatted: `${Number(wei) / 1e18} ${info.nativeSymbol}`,
        symbol: info.nativeSymbol,
        meta: resp.meta,
      });
    },
  );

  s.tool(
    "pocket_get_block_number",
    "Shortcut: get latest block number. Prefer pocket_query for natural language.",
    { chain: z.string() },
    async ({ chain }) => {
      const info = deps.resolveChain(chain);
      if (!info) return chainNotFound(chain);

      const resp = await deps.pocket.rpc<string>(info.slug, "eth_blockNumber", []);
      return textResult({
        blockHex: resp.result,
        blockNumber: parseInt(resp.result, 16),
        meta: resp.meta,
      });
    },
  );

  s.tool(
    "pocket_get_transaction",
    "Get transaction details by hash",
    { chain: z.string(), hash: z.string() },
    async ({ chain, hash }) => {
      const info = deps.resolveChain(chain);
      if (!info) return chainNotFound(chain);

      const resp = await deps.pocket.rpc(info.slug, "eth_getTransactionByHash", [hash]);
      return textResult(
        enrichTxLookupOutput("eth_getTransactionByHash", info.slug, [hash], {
          result: resp.result,
          meta: resp.meta,
        }),
      );
    },
  );

  s.tool(
    "pocket_get_receipt",
    "Get transaction receipt by hash",
    { chain: z.string(), hash: z.string() },
    async ({ chain, hash }) => {
      const info = deps.resolveChain(chain);
      if (!info) return chainNotFound(chain);

      const resp = await deps.pocket.rpc(info.slug, "eth_getTransactionReceipt", [hash]);
      return textResult(
        enrichTxLookupOutput("eth_getTransactionReceipt", info.slug, [hash], {
          result: resp.result,
          meta: resp.meta,
        }),
      );
    },
  );

  s.tool(
    "pocket_call_contract",
    "Execute a read-only contract call (eth_call)",
    {
      chain: z.string(),
      to: z.string(),
      data: z.string(),
      from: z.string().optional(),
      block: z.string().optional().default("latest"),
    },
    async ({ chain, to, data, from, block }) => {
      const info = deps.resolveChain(chain);
      if (!info) return chainNotFound(chain);

      const callObj: Record<string, string> = { to, data };
      if (from) callObj.from = from;

      const resp = await deps.pocket.rpc(info.slug, "eth_call", [callObj, block]);
      return textResult({ result: resp.result, meta: resp.meta });
    },
  );

  s.tool(
    "pocket_get_logs",
    "Fetch event logs (eth_getLogs)",
    {
      chain: z.string(),
      fromBlock: z.string(),
      toBlock: z.string(),
      address: z.string().optional(),
      topics: z.array(z.string()).optional(),
    },
    async ({ chain, fromBlock, toBlock, address, topics }) => {
      const info = deps.resolveChain(chain);
      if (!info) return chainNotFound(chain);

      const filter: Record<string, unknown> = { fromBlock, toBlock };
      if (address) filter.address = address;
      if (topics) filter.topics = topics;

      const resp = await deps.pocket.rpc(info.slug, "eth_getLogs", [filter]);
      return textResult({ result: resp.result, meta: resp.meta });
    },
  );

  s.tool(
    "pocket_estimate_gas",
    "Estimate gas for a transaction",
    {
      chain: z.string(),
      to: z.string(),
      from: z.string().optional(),
      value: z.string().optional(),
      data: z.string().optional(),
    },
    async ({ chain, to, from, value, data }) => {
      const info = deps.resolveChain(chain);
      if (!info) return chainNotFound(chain);

      const tx: Record<string, string> = { to };
      if (from) tx.from = from;
      if (value) tx.value = value;
      if (data) tx.data = data;

      const resp = await deps.pocket.rpc(info.slug, "eth_estimateGas", [tx]);
      return textResult({ gas: resp.result, meta: resp.meta });
    },
  );


  s.tool(
    "pocket_get_nonce",
    "Get transaction count (nonce) for an address. Prefer pocket_query for natural language.",
    {
      chain: z.string(),
      address: z.string(),
      block: z.string().optional().default("latest"),
    },
    async ({ chain, address, block }) => {
      const info = deps.resolveChain(chain);
      if (!info) return chainNotFound(chain);

      const resp = await deps.pocket.rpc(info.slug, "eth_getTransactionCount", [address, block]);
      return textResult({
        address,
        nonce: parseInt(resp.result as string, 16),
        nonceHex: resp.result,
        meta: resp.meta,
      });
    },
  );

  s.tool(
    "pocket_get_token_balance",
    "Get ERC-20 token balance for an address. Prefer pocket_query for natural language.",
    {
      chain: z.string(),
      token: z.string().describe("Token symbol (USDC, USDT, DAI) or contract address"),
      address: z.string(),
    },
    async ({ chain, token, address }) => {
      const info = deps.resolveChain(chain);
      if (!info) return chainNotFound(chain);

      try {
        const result = await getErc20TokenBalance(deps.pocket, info.slug, token, address);
        return textResult(result);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return textResult({ error: message }, true);
      }
    },
  );

  s.tool(
    "pocket_wait_for_receipt",
    "Poll until a transaction is confirmed or timeout",
    {
      chain: z.string(),
      hash: z.string(),
      timeoutMs: z.number().optional().default(120_000),
      pollIntervalMs: z.number().optional().default(2_000),
    },
    async ({ chain, hash, timeoutMs, pollIntervalMs }) => {
      const info = deps.resolveChain(chain);
      if (!info) return chainNotFound(chain);

      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        const resp = await deps.pocket.rpc(info.slug, "eth_getTransactionReceipt", [hash]);
        if (resp.result) {
          const receipt = resp.result as { status?: string };
          return textResult({
            status: receipt.status === "0x1" ? "success" : "reverted",
            receipt: resp.result,
          });
        }
        await new Promise((r) => setTimeout(r, pollIntervalMs));
      }

      return textResult({ status: "timeout", hash }, true);
    },
  );
}
