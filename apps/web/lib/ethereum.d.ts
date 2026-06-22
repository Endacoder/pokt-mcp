export type EthereumProvider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  on?: (event: string, handler: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, handler: (...args: unknown[]) => void) => void;
  /** MetaMask: account currently selected in the extension UI (may differ from eth_accounts[0]). */
  selectedAddress?: string | null;
};

declare global {
  interface Window {
    ethereum?: EthereumProvider;
  }
}

export {};
