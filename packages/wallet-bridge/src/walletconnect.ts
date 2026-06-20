import { MAINNET_CHAIN_IDS } from "@pokt-mcp/shared";
import type { ConnectResult } from "@pokt-mcp/shared";
import type { EthereumProvider } from "./types.js";

let wcProvider: EthereumProvider | undefined;

export function getWcProvider(): EthereumProvider | undefined {
  return wcProvider;
}

export async function connectWalletConnect(
  projectId: string,
  chainIds: number[] = [...MAINNET_CHAIN_IDS],
): Promise<ConnectResult & { provider: EthereumProvider }> {
  if (typeof window === "undefined") {
    throw new Error("WalletConnect requires browser context");
  }

  const { default: EthereumProviderWC } = await import("@walletconnect/ethereum-provider");

  const resolvedChains = chainIds.length ? chainIds : [...MAINNET_CHAIN_IDS];
  const provider = (await EthereumProviderWC.init({
    projectId,
    chains: [resolvedChains[0]],
    optionalChains: resolvedChains as [number, ...number[]],
    showQrModal: true,
    metadata: {
      name: "pokt-mcp",
      description: "Pocket Network MCP wallet",
      url: typeof window !== "undefined" ? window.location.origin : "https://pokt.network",
      icons: ["https://pocket.network/favicon.ico"],
    },
  })) as EthereumProvider;

  await provider.request({ method: "eth_requestAccounts" });
  const accounts = (await provider.request({ method: "eth_accounts" })) as string[];
  const address = accounts[0];
  if (!address) {
    throw new Error("WALLET_NOT_CONNECTED");
  }

  wcProvider = provider;
  return { connected: true, address, provider };
}

export async function disconnectWalletConnect(): Promise<void> {
  if (wcProvider && "disconnect" in wcProvider) {
    await (wcProvider as { disconnect: () => Promise<void> }).disconnect();
  }
  wcProvider = undefined;
}

export function setWcProvider(provider: EthereumProvider | undefined): void {
  wcProvider = provider;
}
