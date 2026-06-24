"use client";

import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import type { ChainInfo } from "../lib/api";
import {
  getProviderChainId,
  slugFromChainId,
} from "../lib/chain-config";
import { ensureSessionToken } from "../lib/session";
import { clearWalletSession, syncWalletSession } from "../lib/wallet-session";
import {
  connectInjectedWallet,
  disconnectWallet,
} from "../lib/wallet-connect";
import type { WalletConnectionType } from "../lib/wallet-provider";

export type { WalletConnectionType } from "../lib/wallet-provider";
export { connectInjectedWallet, disconnectWallet } from "../lib/wallet-connect";

function truncateAddress(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

const MENU_WIDTH_PX = 208; // w-52

function WalletMenu({
  menuRef,
  style,
  onDisconnect,
}: {
  menuRef: RefObject<HTMLDivElement | null>;
  style: { top: number; left: number };
  onDisconnect: () => void;
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
        className="block w-full px-4 py-2.5 text-left text-sm text-red-400 transition-colors hover:bg-pocket-elevated"
        onClick={onDisconnect}
      >
        Disconnect
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
  onDisconnected,
}: {
  apiUrl: string;
  chains: ChainInfo[];
  connectedAddress?: string;
  onConnected: (address: string, mode: WalletConnectionType, chainSlug: string, chainId: number) => void;
  onDisconnected?: () => void;
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

  async function connect() {
    setBusy(true);
    setOpen(false);
    try {
      await ensureSessionToken(apiUrl);
      const { address, provider } = await connectInjectedWallet();
      const chainId = await getProviderChainId(provider);
      const chainSlug = slugFromChainId(chainId, chains);
      if (!chainSlug) {
        throw new Error(`Unsupported wallet chain (ID ${chainId}). Switch to a Pocket-supported network.`);
      }
      await syncWalletSession(apiUrl, address, chainSlug);
      onConnected(address, "injected", chainSlug, chainId);
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    setBusy(true);
    setOpen(false);
    try {
      await disconnectWallet();
      await clearWalletSession(apiUrl);
      onDisconnected?.();
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  function handleClick() {
    if (connectedAddress) {
      setOpen((v) => !v);
      return;
    }
    void connect();
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
        onClick={handleClick}
        aria-expanded={open}
        aria-haspopup={connectedAddress ? "menu" : undefined}
      >
        {busy ? "Connecting…" : connectedAddress ? truncateAddress(connectedAddress) : "Connect Wallet"}
      </button>
      {open && menuStyle && connectedAddress ? (
        <WalletMenu menuRef={menuRef} style={menuStyle} onDisconnect={disconnect} />
      ) : null}
    </>
  );
}
