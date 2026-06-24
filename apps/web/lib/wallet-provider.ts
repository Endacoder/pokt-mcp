import { getAddress } from "viem";
import type { EthereumProvider } from "./ethereum";

export type WalletConnectionType = "injected";

const BOUND_WALLET_KEY = "pocket.boundWallet";
const CONNECTION_MODE_KEY = "pocket.walletMode";

let activeProvider: EthereumProvider | undefined;
let activeConnectionType: WalletConnectionType | undefined;
let boundConnectedAddress: string | undefined;

function readStoredBoundAddress(): string | undefined {
  if (typeof sessionStorage === "undefined") return undefined;
  const stored = sessionStorage.getItem(BOUND_WALLET_KEY)?.trim();
  if (!stored || !/^0x[a-fA-F0-9]{40}$/.test(stored)) return undefined;
  return getAddress(stored);
}

function readStoredConnectionMode(): WalletConnectionType | undefined {
  if (typeof sessionStorage === "undefined") return undefined;
  const mode = sessionStorage.getItem(CONNECTION_MODE_KEY);
  return mode === "injected" ? mode : undefined;
}

/** Address chosen at Connect Wallet — never overwritten by MetaMask account switches. */
export function setBoundConnectedAddress(address: string): void {
  boundConnectedAddress = getAddress(address);
  if (typeof sessionStorage !== "undefined") {
    sessionStorage.setItem(BOUND_WALLET_KEY, boundConnectedAddress);
  }
}

export function getBoundConnectedAddress(): string | undefined {
  if (boundConnectedAddress) return boundConnectedAddress;
  const stored = readStoredBoundAddress();
  if (stored) boundConnectedAddress = stored;
  return boundConnectedAddress;
}

export function clearBoundConnectedAddress(): void {
  boundConnectedAddress = undefined;
  if (typeof sessionStorage !== "undefined") {
    sessionStorage.removeItem(BOUND_WALLET_KEY);
    sessionStorage.removeItem(CONNECTION_MODE_KEY);
  }
}

/** Bind the provider chosen at Connect Wallet (do not rely on window.ethereum alone). */
export function setActiveWalletProvider(
  provider: EthereumProvider,
  mode: WalletConnectionType,
  address?: string,
): void {
  activeProvider = provider;
  activeConnectionType = mode;
  if (typeof sessionStorage !== "undefined") {
    sessionStorage.setItem(CONNECTION_MODE_KEY, mode);
  }
  if (address) setBoundConnectedAddress(address);
}

export function getActiveWalletProvider(): EthereumProvider | undefined {
  return activeProvider;
}

export function getActiveConnectionType(): WalletConnectionType | undefined {
  return activeConnectionType ?? readStoredConnectionMode();
}

export function clearActiveWalletProvider(): void {
  activeProvider = undefined;
  activeConnectionType = undefined;
}

export function clearWalletBinding(): void {
  clearActiveWalletProvider();
  clearBoundConnectedAddress();
}

/** Only the provider bound at Connect Wallet — never fall back to window.ethereum (avoids wrong extension). */
export function resolveWalletProvider(): EthereumProvider | undefined {
  return activeProvider;
}

export function resolveWalletProviderOrThrow(): EthereumProvider {
  const provider = resolveWalletProvider();
  if (!provider) {
    throw new Error("No wallet provider — connect your wallet first");
  }
  return provider;
}

/** MetaMask when multiple injected wallets share window.ethereum. */
export function getInjectedMetaMaskProvider(): EthereumProvider | undefined {
  if (typeof window === "undefined") return undefined;
  const eth = window.ethereum;
  if (!eth) return undefined;
  const multi = eth as EthereumProvider & {
    providers?: EthereumProvider[];
    isMetaMask?: boolean;
  };
  if (multi.providers?.length) {
    const metaMask = multi.providers.find(
      (p) => (p as { isMetaMask?: boolean }).isMetaMask,
    );
    return metaMask ?? multi.providers[0];
  }
  return eth;
}

export function walletConnectionHint(): string {
  if (activeConnectionType === "injected") {
    return "You connected via MetaMask (browser extension).";
  }
  return "Reconnect with Connect Wallet so the app uses one wallet consistently.";
}
