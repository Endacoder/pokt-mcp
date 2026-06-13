import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ChainInfo, PocketClient } from "@pokt-mcp/pocket-client";
import type { WalletBridge } from "@pokt-mcp/wallet-bridge";
import { z } from "zod";
import { chainNotFound, textResult } from "./helpers.js";

interface WalletToolDeps {
  wallet: WalletBridge;
  pocket: PocketClient;
  resolveChain: (alias: string) => ChainInfo | undefined;
}

export function registerWalletTools(server: McpServer, deps: WalletToolDeps) {
  server.tool(
    "wallet_get_status",
    "Get current wallet connection status",
    {},
    async () => textResult(deps.wallet.getStatus()),
  );

  server.tool(
    "wallet_connect",
    "Initiate wallet connection (WalletConnect URI or injected)",
    {
      mode: z.enum(["walletconnect", "injected"]).optional().default("walletconnect"),
    },
    async ({ mode }) => {
      try {
        const result = await deps.wallet.connect(mode);
        return textResult(result);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return textResult({ error: message }, true);
      }
    },
  );

  server.tool(
    "wallet_disconnect",
    "Disconnect the active wallet session",
    {},
    async () => {
      await deps.wallet.disconnect();
      return textResult({ disconnected: true });
    },
  );

  server.tool(
    "wallet_switch_chain",
    "Request a chain switch in the connected wallet",
    { chain: z.string() },
    async ({ chain }) => {
      try {
        await deps.wallet.switchChain(chain);
        return textResult({ switched: chain });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return textResult({ error: message }, true);
      }
    },
  );

  server.tool(
    "wallet_sign_message",
    "Sign a message with the connected wallet",
    { message: z.string() },
    async ({ message }) => {
      try {
        const signature = await deps.wallet.signMessage(message);
        return textResult({ signature });
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        return textResult({ error: errMsg }, true);
      }
    },
  );

  server.tool(
    "wallet_send_transaction",
    "Build, preview, sign, and broadcast a transaction. Set confirm:false for preview only.",
    {
      chain: z.string(),
      to: z.string(),
      value: z.string().optional().describe("Value in wei (hex 0x.. or decimal string)"),
      data: z.string().optional(),
      gas: z.string().optional(),
      confirm: z.boolean().default(false),
    },
    async ({ chain, to, value, data, gas, confirm }) => {
      const info = deps.resolveChain(chain);
      if (!info) return chainNotFound(chain);

      const valueHex = value?.startsWith("0x") ? value : value ? `0x${BigInt(value).toString(16)}` : undefined;

      try {
        if (!confirm) {
          const preview = await deps.wallet.buildTransferPreview({
            chain: info.slug,
            to,
            value: valueHex,
            data,
            gas,
          });
          return textResult({ requiresConfirmation: true, txPreview: preview });
        }

        const result = await deps.wallet.signAndSend(
          { chain: info.slug, to, value: valueHex, data, gas },
          true,
        );
        return textResult(result);
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        return textResult({ error: errMsg }, true);
      }
    },
  );

  server.tool(
    "wallet_send_raw_transaction",
    "Broadcast a pre-signed raw transaction",
    {
      chain: z.string(),
      rawTransaction: z.string(),
      confirm: z.boolean().default(false),
    },
    async ({ chain, rawTransaction, confirm }) => {
      const info = deps.resolveChain(chain);
      if (!info) return chainNotFound(chain);

      try {
        const result = await deps.wallet.sendRawTransaction(info.slug, rawTransaction, confirm);
        return textResult(result);
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        return textResult({ error: errMsg }, true);
      }
    },
  );
}
