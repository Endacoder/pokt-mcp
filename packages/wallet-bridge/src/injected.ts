import type { ConnectResult, WalletStatus } from "@pokt-mcp/shared";
import type { EthereumProvider } from "./types.js";

export async function connectInjected(provider: EthereumProvider): Promise<ConnectResult> {
  const accounts = (await provider.request({ method: "eth_requestAccounts" })) as string[];
  const chainIdHex = (await provider.request({ method: "eth_chainId" })) as string;
  const address = accounts[0];
  if (!address) {
    throw new Error("WALLET_NOT_CONNECTED");
  }
  return {
    connected: true,
    address,
    uri: undefined,
  };
}

export function getInjectedStatus(provider: EthereumProvider | undefined, address?: string): WalletStatus {
  if (!provider || !address) {
    return { connected: false, connectionType: "none" };
  }
  return {
    connected: true,
    address,
    connectionType: "injected",
  };
}

export async function signAndSendInjected(
  provider: EthereumProvider,
  tx: {
    from: string;
    to: string;
    value?: string;
    data?: string;
    gas?: string;
    maxFeePerGas?: string;
    maxPriorityFeePerGas?: string;
    nonce?: number;
    chainId?: number;
  },
): Promise<string> {
  const hash = (await provider.request({
    method: "eth_sendTransaction",
    params: [tx],
  })) as string;
  return hash;
}

export async function signMessageInjected(provider: EthereumProvider, address: string, message: string): Promise<string> {
  return (await provider.request({
    method: "personal_sign",
    params: [message, address],
  })) as string;
}
