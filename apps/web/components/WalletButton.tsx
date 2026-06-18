"use client";

export function WalletButton({
  apiUrl,
  onConnected,
}: {
  apiUrl: string;
  onConnected: (address: string) => void;
}) {
  async function connect() {
    if (!window.ethereum) {
      alert("Install MetaMask or another injected wallet");
      return;
    }
    const accounts = (await window.ethereum.request({ method: "eth_requestAccounts" })) as string[];
    const address = accounts[0];
    if (address) onConnected(address);
  }

  return (
    <button
      className="rounded-md border border-slate-700 px-3 py-2 text-sm hover:bg-slate-800"
      onClick={connect}
    >
      Connect Wallet
    </button>
  );
}

declare global {
  interface Window {
    ethereum?: {
      request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
    };
  }
}
