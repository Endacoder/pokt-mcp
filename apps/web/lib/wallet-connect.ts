import { getAddress } from "viem";
import type { EthereumProvider } from "./ethereum";

const ETH_ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

function parseAddress(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return ETH_ADDRESS_RE.test(trimmed) ? getAddress(trimmed) : undefined;
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
    /* WalletConnect and some injected wallets do not support this caveat */
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
  if (!window.ethereum) {
    throw new Error("Install MetaMask or another injected wallet");
  }
  const provider = window.ethereum;
  const address = await requestSingleAccountAccess(provider);
  return { address, provider };
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

/** Read connected account without prompting (may be empty until user has connected). */
export async function peekConnectedWallet(): Promise<string | undefined> {
  const provider = typeof window !== "undefined" ? window.ethereum : undefined;
  if (!provider) return undefined;
  const accounts = (await provider.request({ method: "eth_accounts" })) as string[] | undefined;
  return parseAddress(accounts?.[0]);
}

/** Refresh the active MetaMask account (may prompt if disconnected). */
export async function refreshConnectedWallet(): Promise<string | undefined> {
  const provider = typeof window !== "undefined" ? window.ethereum : undefined;
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
