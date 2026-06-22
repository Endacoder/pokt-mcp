"use client";

import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import type { ChainInfo } from "../lib/api";
import { BRAND } from "../lib/brand";
import {
  getProviderChainId,
  MAINNET_WC_CHAIN_IDS,
  slugFromChainId,
} from "../lib/chain-config";
import { ensureSessionToken } from "../lib/session";
import { syncWalletSession } from "../lib/wallet-session";
import { getWcProjectId } from "../lib/wallet-config";
import { connectInjectedWallet } from "../lib/wallet-connect";
import type { EthereumProvider } from "../lib/ethereum";

export type WalletConnectionType = "injected" | "walletconnect";

export { connectInjectedWallet } from "../lib/wallet-connect";

let wcProvider: EthereumProvider | undefined;

export async function connectWalletConnect(): Promise<{ address: string; provider: NonNullable<Window["ethereum"]> }> {
  const projectId = await getWcProjectId();

  if (wcProvider) {
    const existing = (await wcProvider.request({ method: "eth_accounts" })) as string[];
    if (existing[0]) {
      window.ethereum = wcProvider;
      return { address: existing[0], provider: wcProvider };
    }
  }

  const { default: EthereumProviderWC } = await import("@walletconnect/ethereum-provider");
  const provider = (await EthereumProviderWC.init({
    projectId,
    chains: [MAINNET_WC_CHAIN_IDS[0]],
    optionalChains: [...MAINNET_WC_CHAIN_IDS],
    showQrModal: true,
    metadata: {
      name: BRAND.name,
      description: BRAND.description,
      url: window.location.origin,
      icons: ["/brand/agent-mark.svg"],
    },
  })) as EthereumProvider;

  await provider.request({ method: "eth_requestAccounts" });
  const accounts = (await provider.request({ method: "eth_accounts" })) as string[];
  const address = accounts[0];
  if (!address) throw new Error("WalletConnect: no accounts");
  wcProvider = provider;
  window.ethereum = provider;
  return { address, provider };
}

function truncateAddress(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

const MENU_WIDTH_PX = 208; // w-52

function WalletMenu({
  menuRef,
  style,
  onConnect,
}: {
  menuRef: RefObject<HTMLDivElement | null>;
  style: { top: number; left: number };
  onConnect: (mode: WalletConnectionType) => void;
}) {
  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      style={{ top: style.top, left: style.left, width: MENU_WIDTH_PX }}
      className="fixed z-[100] overflow-hidden rounded-xl border border-pocket-border bg-pocket-surface py-1 shadow-pocket"
    >
      <button
        type="button"
        role="menuitem"
        className="block w-full px-4 py-2.5 text-left text-sm text-pocket-foreground transition-colors hover:bg-pocket-elevated hover:text-pocket-accent"
        onClick={() => onConnect("injected")}
      >
        MetaMask (Injected)
      </button>
      <button
        type="button"
        role="menuitem"
        className="block w-full px-4 py-2.5 text-left text-sm text-pocket-foreground transition-colors hover:bg-pocket-elevated hover:text-pocket-accent"
        onClick={() => onConnect("walletconnect")}
      >
        WalletConnect
      </button>
    </div>,
    document.body,
  );
}

export function WalletButton({
  apiUrl,
  chains,
  connectedAddress,
  onConnected,
}: {
  apiUrl: string;
  chains: ChainInfo[];
  connectedAddress?: string;
  onConnected: (address: string, mode: WalletConnectionType, chainSlug: string, chainId: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [menuStyle, setMenuStyle] = useState<{ top: number; left: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!open || !buttonRef.current) {
      setMenuStyle(null);
      return;
    }

    function updatePosition() {
      const rect = buttonRef.current!.getBoundingClientRect();
      setMenuStyle({
        top: rect.bottom + 8,
        left: Math.max(8, rect.right - MENU_WIDTH_PX),
      });
    }

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;

    function handleClickOutside(e: MouseEvent) {
      const target = e.target as Node;
      if (buttonRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  async function connect(mode: WalletConnectionType) {
    setBusy(true);
    setOpen(false);
    try {
      await ensureSessionToken(apiUrl);
      const { address, provider } =
        mode === "injected" ? await connectInjectedWallet() : await connectWalletConnect();
      const chainId = await getProviderChainId(provider);
      const chainSlug = slugFromChainId(chainId, chains);
      if (!chainSlug) {
        throw new Error(`Unsupported wallet chain (ID ${chainId}). Switch to a Pocket-supported network.`);
      }
      await syncWalletSession(apiUrl, address, chainSlug);
      onConnected(address, mode, chainSlug, chainId);
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={`rounded-lg px-3 py-2 text-sm font-medium transition-all disabled:opacity-50 ${
          connectedAddress
            ? "border border-pocket-accent/30 bg-pocket-gradient-subtle font-mono text-pocket-accent shadow-sm hover:ring-2 hover:ring-pocket-accent/15"
            : "bg-pocket-gradient text-white shadow-sm hover:shadow-pocket-accent hover:brightness-110"
        }`}
        disabled={busy}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
      >
        {busy ? "Connecting…" : connectedAddress ? truncateAddress(connectedAddress) : "Connect Wallet"}
      </button>
      {open && menuStyle ? (
        <WalletMenu menuRef={menuRef} style={menuStyle} onConnect={connect} />
      ) : null}
    </>
  );
}
