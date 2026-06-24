import { getAddress } from "viem";
import type { EthereumProvider } from "./ethereum";
import {
  clearWalletBinding,
  getBoundConnectedAddress,
  getInjectedMetaMaskProvider,
  resolveWalletProvider,
  setActiveWalletProvider,
} from "./wallet-provider";

const ETH_ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

function parseAddress(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return ETH_ADDRESS_RE.test(trimmed) ? getAddress(trimmed) : undefined;
}

/** Clear all account permissions for this site (call before reconnecting one account). */
export async function revokeSiteWalletPermissions(
  provider: EthereumProvider,
): Promise<void> {
  try {
    await provider.request({
      method: "wallet_revokePermissions",
      params: [{ eth_accounts: {} }],
    });
  } catch {
    /* not supported on older MetaMask */
  }
}

/** Ask MetaMask to authorize exactly one account (reduces wrong-account EIP-712 signatures). */
export async function requestSingleAccountAccess(
  provider: EthereumProvider,
): Promise<string> {
  try {
    await provider.request({
      method: "wallet_requestPermissions",
      params: [
        {
          eth_accounts: {
            caveats: [{ type: "restrictReturnedAccounts", value: 1 }],
          },
        },
      ],
    });
  } catch {
    /* some injected wallets do not support this caveat */
  }

  const accounts = (await provider.request({ method: "eth_requestAccounts" })) as
    | string[]
    | undefined;
  const address = parseAddress(accounts?.[0]);
  if (!address) {
    throw new Error("No accounts returned — connect your wallet first");
  }
  return address;
}

export async function connectInjectedWallet(): Promise<{
  address: string;
  provider: NonNullable<Window["ethereum"]>;
}> {
  const provider = getInjectedMetaMaskProvider();
  if (!provider) {
    throw new Error("Install MetaMask or another injected wallet");
  }
  await revokeSiteWalletPermissions(provider);
  const address = await requestSingleAccountAccess(provider);
  setActiveWalletProvider(provider, "injected", address);
  return { address, provider };
}

/** Tear down injected binding so a stale session cannot sign swaps. */
export async function disconnectWallet(): Promise<void> {
  clearWalletBinding();
}

/** Re-attach provider after reload when bound address is still permitted. */
export async function restoreBoundWalletSession(): Promise<string | undefined> {
  const bound = getBoundConnectedAddress();
  if (!bound) return undefined;

  const provider = getInjectedMetaMaskProvider();
  if (!provider) return bound;

  const accounts = (await provider.request({ method: "eth_accounts" })) as string[] | undefined;
  const permitted = (accounts ?? []).map((a) => parseAddress(a)).filter(Boolean) as string[];
  if (permitted.some((a) => getAddress(a) === getAddress(bound))) {
    setActiveWalletProvider(provider, "injected", bound);
    return bound;
  }
  return bound;
}

/** List accounts MetaMask will use for this site (selected account is first). */
export async function listPermittedAccounts(
  provider: NonNullable<Window["ethereum"]>,
): Promise<string[]> {
  const accounts = (await provider.request({ method: "eth_requestAccounts" })) as
    | string[]
    | undefined;
  const out: string[] = [];
  for (const raw of accounts ?? []) {
    const parsed = parseAddress(raw);
    if (parsed && !out.includes(parsed)) out.push(parsed);
  }
  return out;
}

function resolveConnectedProvider(): EthereumProvider | undefined {
  return resolveWalletProvider();
}

/** Read connected account without prompting (may be empty until user has connected). */
export async function peekConnectedWallet(): Promise<string | undefined> {
  const provider = resolveConnectedProvider();
  if (!provider) return undefined;
  const accounts = (await provider.request({ method: "eth_accounts" })) as string[] | undefined;
  return parseAddress(accounts?.[0]);
}

/** Refresh the active MetaMask account (may prompt if disconnected). */
export async function refreshConnectedWallet(): Promise<string | undefined> {
  const provider = resolveConnectedProvider();
  if (!provider) return undefined;
  try {
    const accounts = (await provider.request({ method: "eth_requestAccounts" })) as
      | string[]
      | undefined;
    return parseAddress(accounts?.[0]);
  } catch {
    return peekConnectedWallet();
  }
}
