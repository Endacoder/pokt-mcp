export const DEFAULT_WALLET_CHAIN = "eth";

export const MAINNET_WC_CHAIN_IDS = [1, 8453, 137, 42161, 10, 43114] as const;

/** Pocket slug for common EVM chain IDs (fallback before /chains loads). */
export const CHAIN_ID_TO_SLUG: Record<number, string> = {
  1: "eth",
  8453: "base",
  137: "poly",
  42161: "arb-one",
  10: "opt",
  43114: "avax",
  100: "gnosis",
  56: "bsc",
  59144: "linea",
  534352: "scroll",
  81457: "blast",
  5000: "mantle",
  42220: "celo",
  250: "fantom",
  1284: "moonbeam",
  2222: "kava",
  80094: "bera",
  324: "zksync",
  252: "fraxtal",
  1088: "metis",
  11155111: "eth-sepolia-testnet",
  84532: "base-sepolia-testnet",
  421614: "arb-sepolia-testnet",
  11155420: "op-sepolia-testnet",
  80002: "poly-amoy-testnet",
};

export const DEFAULT_WALLET_CHAIN_PARAMS = {
  chainId: 1,
  slug: DEFAULT_WALLET_CHAIN,
  chainName: "Ethereum Mainnet",
  rpcUrl: "https://eth.api.pocket.network",
  blockExplorer: "https://etherscan.io",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
} as const;

export function isTestnetChain(slug: string): boolean {
  return slug.includes("testnet") || slug.includes("amoy");
}

export function isMainnetChain(slug: string): boolean {
  return !isTestnetChain(slug);
}

export function slugFromChainId(
  chainId: number,
  chains: { slug: string; chainId?: number }[] = [],
): string | null {
  const fromList = chains.find((c) => c.chainId === chainId);
  if (fromList) return fromList.slug;
  return CHAIN_ID_TO_SLUG[chainId] ?? null;
}

export function chainLabelFromSlug(
  slug: string,
  chains: { slug: string; name: string }[] = [],
): string {
  return chains.find((c) => c.slug === slug)?.name ?? slug;
}

export async function getProviderChainId(provider: {
  request: (args: { method: string }) => Promise<unknown>;
}): Promise<number> {
  const chainIdHex = (await provider.request({ method: "eth_chainId" })) as string;
  return parseInt(chainIdHex, 16);
}

export async function ensureWalletChain(provider: {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
}): Promise<void> {
  const chainIdHex = `0x${DEFAULT_WALLET_CHAIN_PARAMS.chainId.toString(16)}`;
  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: chainIdHex }],
    });
  } catch (err) {
    const code = (err as { code?: number }).code;
    if (code !== 4902) throw err;
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: chainIdHex,
          chainName: DEFAULT_WALLET_CHAIN_PARAMS.chainName,
          rpcUrls: [DEFAULT_WALLET_CHAIN_PARAMS.rpcUrl],
          blockExplorerUrls: [DEFAULT_WALLET_CHAIN_PARAMS.blockExplorer],
          nativeCurrency: DEFAULT_WALLET_CHAIN_PARAMS.nativeCurrency,
        },
      ],
    });
  }
}
