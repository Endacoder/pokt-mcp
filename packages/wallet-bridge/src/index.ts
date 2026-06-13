import { createPocketClient, resolveChain } from "@pokt-mcp/pocket-client";
import type {
  ConnectResult,
  SendResult,
  TxPreview,
  UnsignedTransaction,
  WalletBridge,
  WalletBridgeOptions,
  WalletStatus,
} from "./types.js";

const DEFAULT_MAX_SEND_ETH = parseFloat(process.env.MAX_SEND_VALUE_ETH ?? "1.0");

export function createWalletBridge(options: WalletBridgeOptions = {}): WalletBridge {
  const pocket = createPocketClient();
  const allowedChainsRaw = options.allowedChains ?? process.env.WALLET_ALLOWED_CHAINS ?? "eth,base,poly";
  const allowedList = Array.isArray(allowedChainsRaw)
    ? allowedChainsRaw
    : allowedChainsRaw.split(",").map((s: string) => s.trim());
  const allowed = new Set(allowedList);
  const maxSendEth = options.maxSendValueEth ?? DEFAULT_MAX_SEND_ETH;
  const allowLocal = options.allowLocalSigner ?? process.env.ALLOW_LOCAL_SIGNER === "true";

  let status: WalletStatus = { connected: false, connectionType: "none" };

  function assertConnected(): void {
    if (!status.connected || !status.address) {
      throw new Error("WALLET_NOT_CONNECTED");
    }
  }

  function assertChainAllowed(chain: string): void {
    const info = resolveChain(chain);
    if (!info || !allowed.has(info.slug)) {
      throw new Error(`POLICY_DENIED: chain "${chain}" not in WALLET_ALLOWED_CHAINS`);
    }
  }

  function assertValueLimit(valueHex?: string): void {
    if (!valueHex) return;
    const wei = BigInt(valueHex);
    const maxWei = BigInt(Math.floor(maxSendEth * 1e18));
    if (wei > maxWei) {
      throw new Error(`POLICY_DENIED: value exceeds MAX_SEND_VALUE_ETH (${maxSendEth})`);
    }
  }

  return {
    getStatus() {
      return { ...status };
    },

    async connect(mode = "walletconnect") {
      if (mode === "injected") {
        throw new Error("Injected wallet requires browser context — use web UI");
      }

      if (allowLocal && options.localPrivateKey) {
        status = {
          connected: true,
          address: deriveAddressFromKey(options.localPrivateKey),
          connectionType: "local",
          chainId: 1,
          chainSlug: "eth",
        };
        return { connected: true, address: status.address };
      }

      const projectId = options.walletConnectProjectId ?? process.env.WALLETCONNECT_PROJECT_ID;
      if (!projectId) {
        throw new Error("WALLETCONNECT_PROJECT_ID required for wallet connection");
      }

      // WalletConnect v2 session init — full impl in Phase 3
      const uri = `wc:${crypto.randomUUID()}@2?relay-protocol=irn&symKey=placeholder`;
      return { uri, connected: false };
    },

    async disconnect() {
      status = { connected: false, connectionType: "none" };
    },

    async switchChain(chainSlug) {
      assertConnected();
      assertChainAllowed(chainSlug);
      const info = resolveChain(chainSlug);
      if (!info?.chainId) {
        throw new Error(`Cannot switch to non-EVM chain "${chainSlug}" in v1`);
      }
      status.chainId = info.chainId;
      status.chainSlug = info.slug;
    },

    async signMessage(message) {
      assertConnected();
      throw new Error("USER_ACTION_REQUIRED: signMessage requires wallet popup (Phase 3)");
    },

    async buildTransferPreview(tx) {
      assertChainAllowed(tx.chain);
      assertValueLimit(tx.value);

      const from = tx.from ?? status.address;
      if (!from) throw new Error("WALLET_NOT_CONNECTED");

      const nonceResp = await pocket.rpc<string>(tx.chain, "eth_getTransactionCount", [
        from,
        "latest",
      ]);
      const gasResp = await pocket.rpc<string>(tx.chain, "eth_estimateGas", [
        { from, to: tx.to, value: tx.value ?? "0x0", data: tx.data ?? "0x" },
      ]);

      const preview: TxPreview = {
        summary: `Transfer to ${tx.to} on ${tx.chain}`,
        transaction: {
          ...tx,
          from,
          nonce: parseInt(nonceResp.result, 16),
          gas: gasResp.result,
        },
        estimatedGas: gasResp.result,
      };

      return preview;
    },

    async signAndSend(tx, confirm) {
      assertConnected();
      assertChainAllowed(tx.chain);
      assertValueLimit(tx.value);

      if (!confirm) {
        return this.buildTransferPreview(tx).then((p) => {
          throw new Error(`PENDING_CONFIRMATION: ${JSON.stringify(p)}`);
        });
      }

      if (process.env.REQUIRE_CONFIRMATION !== "false") {
        throw new Error("USER_ACTION_REQUIRED: wallet signature popup (Phase 3)");
      }

      throw new Error("Not implemented");
    },

    async sendRawTransaction(chain, rawTransaction, confirm) {
      assertChainAllowed(chain);
      if (!confirm) {
        throw new Error("PENDING_CONFIRMATION: set confirm=true to broadcast raw transaction");
      }

      const resp = await pocket.broadcast<string>(chain, rawTransaction);
      const info = resolveChain(chain);
      return {
        txHash: resp.result,
        status: "submitted",
        explorerUrl: info?.blockExplorer ? `${info.blockExplorer}/tx/${resp.result}` : undefined,
      };
    },
  };
}

function deriveAddressFromKey(_key: string): string {
  // Placeholder — viem integration in Phase 3
  return "0x0000000000000000000000000000000000000000";
}

export * from "./types.js";
