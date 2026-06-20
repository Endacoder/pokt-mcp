export type {
  ConnectResult,
  ConnectionType,
  SendResult,
  TxPreview,
  UnsignedTransaction,
  WalletStatus,
} from "@pokt-mcp/shared";

export interface WalletBridge {
  getStatus(): import("@pokt-mcp/shared").WalletStatus;
  connect(mode?: "walletconnect" | "injected"): Promise<import("@pokt-mcp/shared").ConnectResult>;
  disconnect(): Promise<void>;
  switchChain(chainSlug: string): Promise<void>;
  signMessage(message: string): Promise<string>;
  buildTransferPreview(tx: import("@pokt-mcp/shared").UnsignedTransaction): Promise<import("@pokt-mcp/shared").TxPreview>;
  signAndSend(tx: import("@pokt-mcp/shared").UnsignedTransaction, confirm: boolean): Promise<import("@pokt-mcp/shared").SendResult>;
  sendRawTransaction(chain: string, rawTransaction: string, confirm: boolean): Promise<import("@pokt-mcp/shared").SendResult>;
}

export interface WalletBridgeOptions {
  walletConnectProjectId?: string;
  allowedChains?: string | string[];
  maxSendValueEth?: number;
  allowLocalSigner?: boolean;
  localPrivateKey?: string;
  ethereumProvider?: EthereumProvider;
}

export interface EthereumProvider {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
  on?(event: string, handler: (...args: unknown[]) => void): void;
  removeListener?(event: string, handler: (...args: unknown[]) => void): void;
}
