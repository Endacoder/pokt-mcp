import { buildTransfer } from "@pokt-mcp/tx-builder";
import { createPocketClient, resolveChain } from "@pokt-mcp/pocket-client";
import type {
  ConnectResult,
  SendResult,
  TxPreview,
  UnsignedTransaction,
  WalletStatus,
} from "@pokt-mcp/shared";
import { privateKeyToAccount } from "viem/accounts";
import {
  connectInjected,
  signAndSendInjected,
  signMessageInjected,
} from "./injected.js";
import type { WalletBridge, WalletBridgeOptions, EthereumProvider } from "./types.js";

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
  let provider: EthereumProvider | undefined = options.ethereumProvider;
  let localAccount: ReturnType<typeof privateKeyToAccount> | undefined;

  let status: WalletStatus = { connected: false, connectionType: "none" };

  if (allowLocal && options.localPrivateKey) {
    localAccount = privateKeyToAccount(options.localPrivateKey as `0x${string}`);
    status = {
      connected: true,
      address: localAccount.address,
      connectionType: "local",
      chainId: 1,
      chainSlug: "eth",
    };
  }

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

    setProvider(next: EthereumProvider) {
      provider = next;
    },

    async connect(mode = "walletconnect") {
      if (mode === "injected") {
        if (!provider) {
          throw new Error("Injected wallet requires browser ethereum provider");
        }
        const result = await connectInjected(provider);
        const chainIdHex = (await provider.request({ method: "eth_chainId" })) as string;
        status = {
          connected: true,
          address: result.address,
          chainId: parseInt(chainIdHex, 16),
          connectionType: "injected",
        };
        return result;
      }

      if (allowLocal && localAccount) {
        return { connected: true, address: localAccount.address };
      }

      const projectId = options.walletConnectProjectId ?? process.env.WALLETCONNECT_PROJECT_ID;
      if (!projectId) {
        throw new Error("WALLETCONNECT_PROJECT_ID required — use injected mode in browser");
      }

      return { uri: `wc:session@2?projectId=${projectId}`, connected: false };
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
      if (provider) {
        await provider.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: `0x${info.chainId.toString(16)}` }],
        });
      }
      status.chainId = info.chainId;
      status.chainSlug = info.slug;
    },

    async signMessage(message) {
      assertConnected();
      if (provider && status.address) {
        return signMessageInjected(provider, status.address, message);
      }
      if (localAccount) {
        return localAccount.signMessage({ message });
      }
      throw new Error("USER_ACTION_REQUIRED: no signing provider available");
    },

    async buildTransferPreview(tx) {
      assertChainAllowed(tx.chain);
      assertValueLimit(tx.value);
      const from = tx.from ?? status.address;
      if (!from) throw new Error("WALLET_NOT_CONNECTED");

      const built = await buildTransfer({
        chain: tx.chain,
        from,
        to: tx.to,
        value: tx.value ? formatWeiHexToEthDecimal(tx.value) : "0",
        data: tx.data,
      });

      const info = resolveChain(tx.chain);
      return {
        summary: `Transfer to ${built.to} on ${tx.chain}`,
        transaction: built,
        estimatedGas: built.gas,
        explorerUrl: info?.blockExplorer,
      } satisfies TxPreview;
    },

    async signAndSend(tx, confirm) {
      assertConnected();
      assertChainAllowed(tx.chain);
      assertValueLimit(tx.value);

      const preview = await this.buildTransferPreview(tx);
      if (!confirm) {
        throw new Error(`PENDING_CONFIRMATION: ${JSON.stringify(preview)}`);
      }

      const unsigned = preview.transaction;
      const info = resolveChain(tx.chain);

      if (provider && status.address) {
        const hash = await signAndSendInjected(provider, {
          from: unsigned.from!,
          to: unsigned.to,
          value: unsigned.value,
          data: unsigned.data,
          gas: unsigned.gas,
          maxFeePerGas: unsigned.maxFeePerGas,
          maxPriorityFeePerGas: unsigned.maxPriorityFeePerGas,
          nonce: unsigned.nonce,
          chainId: unsigned.chainId,
        });
        return {
          txHash: hash,
          status: "submitted",
          explorerUrl: info?.blockExplorer ? `${info.blockExplorer}/tx/${hash}` : undefined,
        } satisfies SendResult;
      }

      if (localAccount && allowLocal) {
        throw new Error("Local signer broadcast requires wallet client — use sendRawTransaction path");
      }

      throw new Error("USER_ACTION_REQUIRED: connect wallet to sign transaction");
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
  } as WalletBridge & { setProvider(provider: EthereumProvider): void };
}

function formatWeiHexToEthDecimal(valueHex: string): string {
  const wei = BigInt(valueHex);
  return (Number(wei) / 1e18).toString();
}

export * from "./types.js";
export * from "./injected.js";
