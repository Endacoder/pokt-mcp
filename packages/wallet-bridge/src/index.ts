import { buildTransfer } from "@pokt-mcp/tx-builder";
import { createPocketClient, resolveChain } from "@pokt-mcp/pocket-client";
import { parseAllowedChains, MAINNET_CHAIN_IDS } from "@pokt-mcp/shared";
import type {
  ConnectResult,
  SendResult,
  TxPreview,
  UnsignedTransaction,
  WalletStatus,
} from "@pokt-mcp/shared";
import { privateKeyToAccount } from "viem/accounts";
import { createWalletClient, defineChain, http } from "viem";
import {
  connectInjected,
  signAndSendInjected,
  signMessageInjected,
} from "./injected.js";
import {
  connectWalletConnect,
  disconnectWalletConnect,
  getWcProvider,
} from "./walletconnect.js";
import type { WalletBridge, WalletBridgeOptions, EthereumProvider } from "./types.js";

const DEFAULT_MAX_SEND_ETH = parseFloat(process.env.MAX_SEND_VALUE_ETH ?? "1.0");

export function createWalletBridge(options: WalletBridgeOptions = {}): WalletBridge {
  const pocket = createPocketClient();
  const allowedList = Array.isArray(options.allowedChains)
    ? options.allowedChains
    : parseAllowedChains();
  const allowed = new Set(allowedList);
  const maxSendEth = options.maxSendValueEth ?? DEFAULT_MAX_SEND_ETH;
  const allowLocal = options.allowLocalSigner ?? process.env.ALLOW_LOCAL_SIGNER === "true";
  const privateKey =
    options.localPrivateKey ??
    (allowLocal && process.env.PRIVATE_KEY ? (process.env.PRIVATE_KEY as `0x${string}`) : undefined);
  let provider: EthereumProvider | undefined = options.ethereumProvider;
  let localAccount: ReturnType<typeof privateKeyToAccount> | undefined;

  let status: WalletStatus = { connected: false, connectionType: "none" };

  if (allowLocal && privateKey) {
    localAccount = privateKeyToAccount(privateKey as `0x${string}`);
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

      if (typeof window !== "undefined") {
        const chainIds = allowedList
          .map((slug) => resolveChain(slug)?.chainId)
          .filter((id): id is number => id !== undefined);
        const result = await connectWalletConnect(projectId, chainIds.length ? chainIds : [...MAINNET_CHAIN_IDS]);
        provider = result.provider;
        const chainIdHex = (await provider.request({ method: "eth_chainId" })) as string;
        status = {
          connected: true,
          address: result.address,
          chainId: parseInt(chainIdHex, 16),
          connectionType: "walletconnect",
        };
        return { connected: true, address: result.address };
      }

      const existing = getWcProvider();
      if (existing) {
        provider = existing;
        const accounts = (await existing.request({ method: "eth_accounts" })) as string[];
        if (accounts[0]) {
          status = {
            connected: true,
            address: accounts[0],
            connectionType: "walletconnect",
          };
          return { connected: true, address: accounts[0] };
        }
      }

      return { uri: `wc:session@2?projectId=${projectId}`, connected: false };
    },

    async disconnect() {
      if (status.connectionType === "walletconnect") {
        await disconnectWalletConnect();
      }
      provider = undefined;
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
        const chainInfo = resolveChain(tx.chain);
        if (!chainInfo?.chainId || !chainInfo.endpoint) {
          throw new Error(`CHAIN_NOT_FOUND: ${tx.chain}`);
        }
        const viemChain = defineChain({
          id: chainInfo.chainId,
          name: chainInfo.name,
          nativeCurrency: { name: chainInfo.nativeSymbol, symbol: chainInfo.nativeSymbol, decimals: 18 },
          rpcUrls: { default: { http: [chainInfo.endpoint] } },
        });
        const walletClient = createWalletClient({
          account: localAccount,
          chain: viemChain,
          transport: http(chainInfo.endpoint),
        });
        const hash = await walletClient.sendTransaction({
          to: unsigned.to as `0x${string}`,
          value: unsigned.value ? BigInt(unsigned.value) : 0n,
          data: (unsigned.data ?? "0x") as `0x${string}`,
          gas: unsigned.gas ? BigInt(unsigned.gas) : undefined,
          maxFeePerGas: unsigned.maxFeePerGas ? BigInt(unsigned.maxFeePerGas) : undefined,
          maxPriorityFeePerGas: unsigned.maxPriorityFeePerGas
            ? BigInt(unsigned.maxPriorityFeePerGas)
            : undefined,
          nonce: unsigned.nonce,
          chain: viemChain,
        });
        return {
          txHash: hash,
          status: "submitted",
          explorerUrl: info?.blockExplorer ? `${info.blockExplorer}/tx/${hash}` : undefined,
        } satisfies SendResult;
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
export * from "./walletconnect.js";
