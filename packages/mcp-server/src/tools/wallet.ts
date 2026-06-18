import type { ChainInfo, PocketClient } from "@pokt-mcp/pocket-client";
import type { WalletBridge } from "@pokt-mcp/wallet-bridge";
import { z } from "zod";
import { loadPolicyConfig, assertWritePolicy } from "../middleware/policy.js";
import { writeAudit } from "../middleware/audit.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { asToolServer, chainNotFound, textResult } from "./helpers.js";

interface WalletToolDeps {
  wallet: WalletBridge;
  pocket: PocketClient;
  resolveChain: (alias: string) => ChainInfo | undefined;
}

export function registerWalletTools(server: McpServer, deps: WalletToolDeps) {
  const policy = loadPolicyConfig();
  const s = asToolServer(server);

  s.tool("wallet_get_status", "Get current wallet connection status", {}, async () =>
    textResult(deps.wallet.getStatus()),
  );

  s.tool(
    "wallet_connect",
    "Initiate wallet connection (WalletConnect URI or injected)",
    { mode: z.enum(["walletconnect", "injected"]).optional().default("walletconnect") },
    async ({ mode }) => {
      try {
        return textResult(await deps.wallet.connect(mode));
      } catch (err) {
        return textResult({ error: err instanceof Error ? err.message : String(err) }, true);
      }
    },
  );

  s.tool("wallet_disconnect", "Disconnect the active wallet session", {}, async () => {
    await deps.wallet.disconnect();
    return textResult({ disconnected: true });
  });

  s.tool("wallet_switch_chain", "Request a chain switch in the connected wallet", { chain: z.string() }, async ({ chain }) => {
    try {
      await deps.wallet.switchChain(chain);
      return textResult({ switched: chain });
    } catch (err) {
      return textResult({ error: err instanceof Error ? err.message : String(err) }, true);
    }
  });

  s.tool("wallet_sign_message", "Sign a message with the connected wallet", { message: z.string() }, async ({ message }) => {
    try {
      return textResult({ signature: await deps.wallet.signMessage(message) });
    } catch (err) {
      return textResult({ error: err instanceof Error ? err.message : String(err) }, true);
    }
  });

  s.tool(
    "wallet_send_transaction",
    "Build, preview, sign, and broadcast a transaction. Set confirm:false for preview only.",
    {
      chain: z.string(),
      to: z.string(),
      value: z.string().optional(),
      data: z.string().optional(),
      gas: z.string().optional(),
      confirm: z.boolean().default(false),
    },
    async ({ chain, to, value, data, gas, confirm }) => {
      const info = deps.resolveChain(chain);
      if (!info) return chainNotFound(chain);

      const valueHex = value?.startsWith("0x") ? value : value ? `0x${BigInt(value).toString(16)}` : undefined;
      const tx = { chain: info.slug, to, value: valueHex, data, gas };

      try {
        assertWritePolicy(policy, tx);

        if (!confirm) {
          const preview = await deps.wallet.buildTransferPreview(tx);
          return textResult({ requiresConfirmation: true, txPreview: preview });
        }

        if (policy.requireConfirmation) {
          // second gate — MCP caller must have shown preview first
        }

        const status = deps.wallet.getStatus();
        const result = await deps.wallet.signAndSend(tx, true);
        await writeAudit({
          timestamp: new Date().toISOString(),
          tool: "wallet_send_transaction",
          chain: info.slug,
          from: status.address,
          to,
          value: valueHex,
          txHash: result.txHash,
          status: result.status,
        });
        return textResult(result);
      } catch (err) {
        return textResult({ error: err instanceof Error ? err.message : String(err) }, true);
      }
    },
  );

  s.tool(
    "wallet_send_raw_transaction",
    "Broadcast a pre-signed raw transaction",
    { chain: z.string(), rawTransaction: z.string(), confirm: z.boolean().default(false) },
    async ({ chain, rawTransaction, confirm }) => {
      const info = deps.resolveChain(chain);
      if (!info) return chainNotFound(chain);
      try {
        const result = await deps.wallet.sendRawTransaction(info.slug, rawTransaction, confirm);
        await writeAudit({
          timestamp: new Date().toISOString(),
          tool: "wallet_send_raw_transaction",
          chain: info.slug,
          txHash: result.txHash,
          status: result.status,
        });
        return textResult(result);
      } catch (err) {
        return textResult({ error: err instanceof Error ? err.message : String(err) }, true);
      }
    },
  );
}
