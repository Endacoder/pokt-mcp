import { slugFromChainId } from "./chain-config";

const POCKET_PORTAL_HOST = "api.pocket.network";

/** Pocket portal host slug overrides (see packages/pocket-client registry). */
const POCKET_HOST_SLUG: Record<string, string> = {
  opt: "op",
  zksync: "zksync-era",
};

export function pocketRpcUrlForSlug(slug: string): string {
  const hostSlug = POCKET_HOST_SLUG[slug] ?? slug;
  return `https://${hostSlug}.${POCKET_PORTAL_HOST}`;
}

export function pocketRpcUrlForChainId(chainId: number): string | null {
  const slug = slugFromChainId(chainId);
  if (!slug) return null;
  return pocketRpcUrlForSlug(slug);
}

type NetworkMeta = {
  chainName: string;
  blockExplorer?: string;
  nativeCurrency: { name: string; symbol: string; decimals: number };
};

const NETWORK_META: Partial<Record<number, NetworkMeta>> = {
  1: {
    chainName: "Ethereum Mainnet",
    blockExplorer: "https://etherscan.io",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  },
  8453: {
    chainName: "Base",
    blockExplorer: "https://basescan.org",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  },
  137: {
    chainName: "Polygon",
    blockExplorer: "https://polygonscan.com",
    nativeCurrency: { name: "POL", symbol: "POL", decimals: 18 },
  },
  42161: {
    chainName: "Arbitrum One",
    blockExplorer: "https://arbiscan.io",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  },
  10: {
    chainName: "Optimism",
    blockExplorer: "https://optimistic.etherscan.io",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  },
  43114: {
    chainName: "Avalanche C-Chain",
    blockExplorer: "https://snowtrace.io",
    nativeCurrency: { name: "AVAX", symbol: "AVAX", decimals: 18 },
  },
};

type WalletProvider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
};

/**
 * Point MetaMask at Pocket RPC for the swap chain.
 * Always calls wallet_addEthereumChain after switch — MetaMask prompts to update RPC when it differs.
 */
export async function ensureWalletNetworkForSwap(
  provider: WalletProvider,
  chainId: number,
): Promise<void> {
  const rpcUrl = pocketRpcUrlForChainId(chainId);
  if (!rpcUrl) return;

  const chainIdHex = `0x${chainId.toString(16)}`;
  const meta = NETWORK_META[chainId];
  const networkParams = {
    chainId: chainIdHex,
    chainName: meta?.chainName ?? `Chain ${chainId}`,
    rpcUrls: [rpcUrl],
    blockExplorerUrls: meta?.blockExplorer ? [meta.blockExplorer] : undefined,
    nativeCurrency: meta?.nativeCurrency ?? { name: "Ether", symbol: "ETH", decimals: 18 },
  };

  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: chainIdHex }],
    });
  } catch (err) {
    const code = (err as { code?: number }).code;
    if (code !== 4902) throw err;
  }

  try {
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [networkParams],
    });
  } catch (err) {
    const code = (err as { code?: number }).code;
    if (code === 4001) throw err;
    /* User dismissed RPC update — eth_sendTransaction may still hit the old RPC. */
  }
}

export function pocketRpcSetupHint(chainId?: number): string {
  const rpcUrl =
    chainId != null ? pocketRpcUrlForChainId(chainId) : "https://eth.api.pocket.network";
  return (
    `Gas swaps need a working network RPC in MetaMask. ` +
    `Open MetaMask → Settings → Networks → edit this network → set RPC URL to ${rpcUrl ?? "a Pocket RPC URL"}, save, then retry. ` +
    `Or use Best price / Gasless in swap settings to avoid on-chain approval transactions.`
  );
}
