export type ConnectionType = "walletconnect" | "injected" | "local" | "none";

export interface WalletStatus {
  connected: boolean;
  address?: string;
  chainId?: number;
  chainSlug?: string;
  connectionType: ConnectionType;
}

export interface UnsignedTransaction {
  chain: string;
  from?: string;
  to: string;
  value?: string;
  data?: string;
  gas?: string;
  gasPrice?: string;
  maxFeePerGas?: string;
  maxPriorityFeePerGas?: string;
  nonce?: number;
  chainId?: number;
}

export interface SignedTransaction {
  rawTransaction: string;
  hash?: string;
}

export interface ConnectResult {
  uri?: string;
  connected: boolean;
  address?: string;
}

export interface TxPreview {
  summary: string;
  transaction: UnsignedTransaction;
  estimatedGas?: string;
}

export interface SendResult {
  txHash: string;
  status: "submitted" | "rejected";
  explorerUrl?: string;
}

export interface WalletBridge {
  getStatus(): WalletStatus;
  connect(mode?: "walletconnect" | "injected"): Promise<ConnectResult>;
  disconnect(): Promise<void>;
  switchChain(chainSlug: string): Promise<void>;
  signMessage(message: string): Promise<string>;
  buildTransferPreview(tx: UnsignedTransaction): Promise<TxPreview>;
  signAndSend(tx: UnsignedTransaction, confirm: boolean): Promise<SendResult>;
  sendRawTransaction(chain: string, rawTransaction: string, confirm: boolean): Promise<SendResult>;
}

export interface WalletBridgeOptions {
  walletConnectProjectId?: string;
  allowedChains?: string[];
  maxSendValueEth?: number;
  allowLocalSigner?: boolean;
  localPrivateKey?: string;
}
