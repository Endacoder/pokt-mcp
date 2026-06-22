"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getAddress } from "viem";
import { syncWalletSession } from "../lib/wallet-session";
import { peekConnectedWallet } from "../lib/wallet-connect";
import { AdvancedRpcPanel } from "../components/AdvancedRpcPanel";
import { ChatInput, type ChatInputHandle } from "../components/ChatInput";
import { ChatMessage } from "../components/ChatMessage";
import { CommandsBar } from "../components/CommandsBar";
import { ConversationSidebar } from "../components/ConversationSidebar";
import { AgentMark } from "../components/brand/AgentMark";
import { BrandWordmark } from "../components/brand/BrandWordmark";
import { BRAND } from "../lib/brand";
import { ThemeSync } from "../components/ThemeInit";
import { ScrollToBottom } from "../components/ScrollToBottom";
import { SettingsDrawer } from "../components/SettingsDrawer";
import { SuggestionChips } from "../components/SuggestionChips";
import { ToolsStatusPanel } from "../components/ToolsStatusPanel";
import { SwapConfirmModal } from "../components/SwapConfirmModal";
import { SwapExecutionModePicker } from "../components/SwapExecutionModePicker";
import { SwapStatusBox, SwapStatusChip } from "../components/SwapStatusBox";
import { TxConfirmModal } from "../components/TxConfirmModal";
import { WalletButton } from "../components/WalletButton";
import { WalletChainBadge } from "../components/WalletChainBadge";
import { getApiUrl } from "../lib/api-url";
import { isThinkingEnabled } from "../lib/feature-flags";
import type { SwapFlowState, SwapPhase } from "../lib/swap-status";
import type { SwapQuoteDisplay } from "../lib/swap-api";
import { toDisplayString } from "../lib/format";
import { buildChatHistory } from "../lib/chat-history";
import { fetchChains, parseChatSse, postChat, recordSubmittedTransaction, type ChainInfo } from "../lib/api";
import { commandHandle, resolveChatMessage, type McpCommand } from "../lib/mcp-commands";
import { getSessionId } from "../lib/session";
import {
  clearAllConversations,
  createConversation,
  deleteConversation,
  getActiveConversationId,
  loadConversations,
  saveConversations,
  setActiveConversationId,
  updateConversationMessages,
  upsertConversation,
} from "../lib/conversations";
import { loadSettings, updateSettings, type AppSettings } from "../lib/settings";
import { isHiddenToolCall, sanitizeAssistantContent } from "../lib/tool-calls";
import { DEFAULT_WALLET_CHAIN, isMainnetChain, slugFromChainId } from "../lib/chain-config";
import type { Conversation, Message, ToolCall } from "../lib/types";

const API_URL = getApiUrl();

function latestSwapQuoteFromMessages(messages: Message[]): SwapFlowState | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== "assistant" || m.result?.route !== "intent-swap") continue;
    const display = (m.result.output as { display?: SwapQuoteDisplay } | undefined)?.display;
    if (display && typeof display.quoteId === "string") {
      return { phase: "quoted", display, quoteId: display.quoteId };
    }
  }
  return null;
}

export default function HomePage() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [chain, setChain] = useState(DEFAULT_WALLET_CHAIN);
  const [chains, setChains] = useState<ChainInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [walletAddress, setWalletAddress] = useState<string>();
  const [walletChainId, setWalletChainId] = useState<number>();
  const [pendingTx, setPendingTx] = useState<Record<string, unknown> | null>(null);
  const [pendingSwap, setPendingSwap] = useState<{
    quoteId: string;
    display: SwapQuoteDisplay;
  } | null>(null);
  const [swapFlow, setSwapFlow] = useState<SwapFlowState | null>(null);
  const [settings, setSettings] = useState<AppSettings>(() => ({
    defaultChain: DEFAULT_WALLET_CHAIN,
    showToolDetailsExpanded: false,
    showAdvancedRpc: false,
    sidebarOpen: true,
    theme: "system",
    swapExecutionMode: "any",
  }));
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const chatInputRef = useRef<ChatInputHandle>(null);
  const abortRef = useRef<AbortController | null>(null);
  const activeConvRef = useRef<Conversation | null>(null);

  useEffect(() => {
    if (!hydrated) return;
    const latest = latestSwapQuoteFromMessages(messages);
    if (!latest) return;
    setSwapFlow((prev) => {
      if (prev?.quoteId === latest.quoteId) {
        if (
          prev.phase === "preparing" ||
          prev.phase === "signing" ||
          prev.phase === "submitting" ||
          prev.phase === "confirm"
        ) {
          return prev;
        }
        return prev;
      }
      if (
        prev &&
        (prev.phase === "preparing" || prev.phase === "signing" || prev.phase === "submitting")
      ) {
        return prev;
      }
      return latest;
    });
  }, [messages, hydrated]);

  useEffect(() => {
    if (swapFlow?.phase !== "done") return;
    const timer = window.setTimeout(() => setSwapFlow(null), 12_000);
    return () => window.clearTimeout(timer);
  }, [swapFlow?.phase, swapFlow?.quoteId]);

  function openSwapConfirm() {
    if (!swapFlow) return;
    setPendingSwap({ quoteId: swapFlow.quoteId, display: swapFlow.display });
    setSwapFlow((prev) => (prev ? { ...prev, phase: "confirm" } : prev));
  }

  function handleConfirmSwap(swap: { quoteId: string; display: SwapQuoteDisplay }) {
    setPendingSwap(swap);
    setSwapFlow({ phase: "confirm", display: swap.display, quoteId: swap.quoteId });
  }

  function handleSwapPhaseChange(phase: SwapPhase) {
    setSwapFlow((prev) => (prev ? { ...prev, phase } : null));
  }

  const chainOptions = (() => {
    const mainnets = chains.filter((c) => isMainnetChain(c.slug));
    return mainnets.length ? mainnets : [{ slug: DEFAULT_WALLET_CHAIN, name: "Ethereum Mainnet" }];
  })();

  // Hydrate conversations from localStorage
  useEffect(() => {
    try {
      const userSettings = loadSettings();
      setSettings(userSettings);
      setChain(userSettings.defaultChain);

      const stored = loadConversations();
      const active = getActiveConversationId();
      setConversations(stored);
      if (active && stored.find((c) => c.id === active)) {
        const conv = stored.find((c) => c.id === active)!;
        setActiveId(active);
        setMessages(conv.messages);
        setChain(conv.chain);
      } else if (stored.length > 0) {
        const conv = stored[0];
        setActiveId(conv.id);
        setMessages(conv.messages);
        setChain(conv.chain);
        setActiveConversationId(conv.id);
      } else {
        const conv = createConversation(userSettings.defaultChain);
        setActiveId(conv.id);
        setConversations([conv]);
        setActiveConversationId(conv.id);
        saveConversations([conv]);
      }
    } catch (err) {
      console.error("Failed to hydrate app state:", err);
      const conv = createConversation(DEFAULT_WALLET_CHAIN);
      setActiveId(conv.id);
      setConversations([conv]);
      setActiveConversationId(conv.id);
    } finally {
      setHydrated(true);
    }
  }, []);

  useEffect(() => {
    import("../lib/session").then(({ ensureSessionToken }) => {
      ensureSessionToken(API_URL).catch((err) => console.error("Session token bootstrap failed:", err));
    });
    fetchChains(API_URL)
      .then(setChains)
      .catch(() => {
        setChains([
          { slug: "eth", name: "Ethereum Mainnet", chainId: 1 },
          { slug: "base", name: "Base", chainId: 8453 },
          { slug: "poly", name: "Polygon", chainId: 137 },
        ]);
      });
  }, []);

  const applyWalletFromProvider = useCallback(
    (next: string | undefined) => {
      if (!next) {
        setPendingSwap(null);
        setSwapFlow(null);
        setWalletAddress(undefined);
        return;
      }
      setWalletAddress((prev) => {
        if (prev && getAddress(prev) !== getAddress(next)) {
          setPendingSwap(null);
          setSwapFlow(null);
        }
        return next;
      });
      void syncWalletSession(API_URL, next, chain).catch((err) =>
        console.error("Wallet session sync failed:", err),
      );
    },
    [chain],
  );

  // Keep app wallet + chain in sync when the user switches account or network in MetaMask.
  useEffect(() => {
    const provider = window.ethereum;
    if (!provider?.on) return;

    const onAccountsChanged = (...args: unknown[]) => {
      const accounts = args[0] as string[] | undefined;
      const next = accounts?.[0]?.trim();
      if (next && /^0x[a-fA-F0-9]{40}$/.test(next)) {
        applyWalletFromProvider(next);
      } else {
        applyWalletFromProvider(undefined);
      }
    };

    const onChainChanged = (...args: unknown[]) => {
      const chainIdHex = String(args[0] ?? "");
      const chainId = parseInt(chainIdHex, 16);
      const slug = slugFromChainId(chainId, chains);
      if (slug) {
        setWalletChainId(chainId);
        setChain(slug);
      }
    };

    provider.on("accountsChanged", onAccountsChanged);
    provider.on("chainChanged", onChainChanged);
    return () => {
      provider.removeListener?.("accountsChanged", onAccountsChanged);
      provider.removeListener?.("chainChanged", onChainChanged);
    };
  }, [chains, chain, applyWalletFromProvider]);

  function handleWalletConnected(address: string, _mode: unknown, chainSlug: string, chainId: number) {
    setWalletAddress(address);
    setWalletChainId(chainId);
    setChain(chainSlug);
  }

  // On load / tab focus, sync header wallet with MetaMask's active account (eth_accounts[0]).
  useEffect(() => {
    if (!hydrated) return;
    void peekConnectedWallet().then((addr) => {
      if (addr) applyWalletFromProvider(addr);
    });
  }, [hydrated, applyWalletFromProvider]);

  useEffect(() => {
    if (!hydrated) return;
    const onFocus = () => {
      void peekConnectedWallet().then((addr) => {
        if (addr) applyWalletFromProvider(addr);
        else if (walletAddress) applyWalletFromProvider(undefined);
      });
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [hydrated, applyWalletFromProvider, walletAddress]);

  const persistConversation = useCallback(
    (msgs: Message[], chainSlug: string, convId: string | null) => {
      if (!convId) return;
      setConversations((prev) => {
        const conv = prev.find((c) => c.id === convId);
        if (!conv) return prev;
        const updated = updateConversationMessages(conv, msgs);
        updated.chain = chainSlug;
        const next = upsertConversation(prev, updated);
        saveConversations(next);
        return next;
      });
    },
    [],
  );

  useEffect(() => {
    if (!hydrated || loading) return;
    persistConversation(messages, chain, activeId);
  }, [messages, chain, activeId, hydrated, loading, persistConversation]);

  const scrollToBottom = useCallback((smooth = true) => {
    messagesEndRef.current?.scrollIntoView({ behavior: smooth ? "smooth" : "auto" });
  }, []);

  useEffect(() => {
    if (!showScrollBtn) scrollToBottom();
  }, [messages, loading, showScrollBtn, scrollToBottom]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    function onScroll() {
      const dist = el!.scrollHeight - el!.scrollTop - el!.clientHeight;
      setShowScrollBtn(dist > 120);
    }
    el.addEventListener("scroll", onScroll);
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  const getActiveConversation = useCallback((): Conversation => {
    const existing = conversations.find((c) => c.id === activeId);
    if (existing) return existing;
    const conv = createConversation(chain);
    return conv;
  }, [conversations, activeId, chain]);

  const stopGeneration = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setLoading(false);
    setMessages((m) => {
      const copy = [...m];
      const last = copy[copy.length - 1];
      if (last?.role === "assistant") {
        copy[copy.length - 1] = {
          ...last,
          streaming: false,
          interrupted: true,
          content: last.content || "Stopped.",
        };
      }
      return copy;
    });
  }, []);

  const sendChat = useCallback(
    async (text?: string) => {
      const raw = (text ?? input).trim();
      const userMessage = resolveChatMessage(raw, {
        context: walletAddress ? { walletAddress, chain } : undefined,
      });
      if (!userMessage || loading) return;

      let conv = getActiveConversation();
      if (!activeId) {
        setActiveId(conv.id);
        setConversations((prev) => upsertConversation(prev, conv));
        setActiveConversationId(conv.id);
      }
      activeConvRef.current = conv;

      const priorMessages = messages;
      const chatHistory = buildChatHistory(priorMessages);

      setInput("");
      setMessages((m) => [
        ...m,
        { role: "user", content: userMessage },
        { role: "assistant", content: "", streaming: true, toolCalls: [], thinkingLog: [] },
      ]);
      setLoading(true);

      const controller = new AbortController();
      abortRef.current = controller;

      let assistant = "";
      let resultData: Record<string, unknown> | undefined;
      let errorMsg: string | undefined;
      const toolCalls: ToolCall[] = [];
      const thinkingLog: string[] = [];

      function upsertToolCall(data: {
        tool: string;
        input?: unknown;
        args?: unknown;
        intent?: Record<string, unknown>;
        status?: "running" | "done" | "error";
        output?: unknown;
        latencyMs?: number;
      }) {
        const inputVal = data.input ?? data.args;
        if (data.status === "done" || data.status === "error") {
          for (let i = toolCalls.length - 1; i >= 0; i--) {
            if (toolCalls[i].tool === data.tool && toolCalls[i].status === "running") {
              toolCalls[i] = {
                ...toolCalls[i],
                status: data.status,
                output: data.output,
                latencyMs: data.latencyMs,
              };
              return;
            }
          }
        }
        toolCalls.push({
          tool: data.tool,
          input: inputVal,
          intent: data.intent,
          status: data.status ?? "running",
          output: data.output,
          latencyMs: data.latencyMs,
        });
      }

      function patchAssistant(patch: Partial<Message & { role: "assistant" }>) {
        setMessages((m) => {
          const copy = [...m];
          const last = copy[copy.length - 1];
          if (last?.role === "assistant") {
            copy[copy.length - 1] = { ...last, ...patch };
          }
          return copy;
        });
      }

      try {
        const res = await postChat(
          API_URL,
          {
            message: userMessage,
            history: chatHistory.length > 0 ? chatHistory : undefined,
            chain,
            sessionId: getSessionId(),
            connectedAddress: walletAddress,
            swapExecutionMode: settings.swapExecutionMode,
          },
          { signal: controller.signal },
        );
        if (!res.ok) {
          const hint =
            res.status === 524 || res.status === 504
              ? " The server took too long — check that LiteLLM is reachable from the API container (LITELLM_BASE_URL) or try a simpler query."
              : "";
          throw new Error(`Chat failed: ${res.status}${hint}`);
        }

        for await (const evt of parseChatSse(res)) {
          if (evt.event === "status") {
            const msg = (evt.data as { message?: unknown })?.message;
            if (msg != null && isThinkingEnabled()) {
              thinkingLog.push(toDisplayString(msg));
              patchAssistant({
                content: sanitizeAssistantContent(assistant),
                streaming: true,
                toolCalls: [...toolCalls],
                thinkingLog: [...thinkingLog],
              });
            }
          } else if (evt.event === "token") {
            const raw = (evt.data as { text?: unknown })?.text;
            const token = raw != null ? toDisplayString(raw) : "";
            if (token && !/^Parsing query\.\.\.\n?$/i.test(token.trim())) {
              assistant += token;
              patchAssistant({
                content: sanitizeAssistantContent(assistant),
                streaming: true,
                toolCalls: [...toolCalls],
                thinkingLog: [...thinkingLog],
              });
            }
          } else if (evt.event === "tool") {
            const data = evt.data as {
              tool: string;
              input?: unknown;
              args?: unknown;
              intent?: Record<string, unknown>;
              status?: "running" | "done" | "error";
              output?: unknown;
              latencyMs?: number;
            };
            if (isHiddenToolCall(data.tool)) continue;
            upsertToolCall(data);
            patchAssistant({
              content: assistant,
              streaming: true,
              toolCalls: [...toolCalls],
              thinkingLog: [...thinkingLog],
            });
          } else if (evt.event === "result") {
            const data = evt.data as Record<string, unknown>;
            if (data.requiresConfirmation) {
              setPendingTx(data);
            } else {
              resultData = data;
              if (toolCalls.length > 0) {
                const last = toolCalls[toolCalls.length - 1];
                last.status = "done";
                last.latencyMs = data.latencyMs as number | undefined;
                last.output = data.output;
              }
            }
          } else if (evt.event === "error") {
            const data = evt.data as { message?: unknown; code?: string };
            const raw = data?.message;
            if (data?.code === "WALLET_NOT_CONNECTED") {
              errorMsg = "Connect your wallet using the button above, then ask again.";
            } else {
              errorMsg = raw != null ? toDisplayString(raw) : "Unknown error";
            }
            if (toolCalls.length > 0) {
              toolCalls[toolCalls.length - 1].status = "error";
            }
          }
        }

        if (!assistant && !resultData && !errorMsg) {
          assistant = "Query processed.";
        }
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        errorMsg = err instanceof Error ? err.message : String(err);
      } finally {
        abortRef.current = null;
      }

      patchAssistant({
        content: sanitizeAssistantContent(assistant) || (errorMsg ? "" : "Done."),
        result: resultData,
        error: errorMsg,
        streaming: false,
        toolCalls: [...toolCalls],
        thinkingLog: [...thinkingLog],
      });
      setLoading(false);
    },
    [input, chain, loading, activeId, getActiveConversation, walletAddress, settings.swapExecutionMode, messages],
  );

  function handleNewChat() {
    const conv = createConversation(settings.defaultChain);
    setConversations((prev) => {
      const next = upsertConversation(prev, conv);
      saveConversations(next);
      return next;
    });
    setActiveId(conv.id);
    setActiveConversationId(conv.id);
    setMessages([]);
    setInput("");
    setChain(conv.chain);
    setPendingTx(null);
    setLoading(false);
  }

  function handleSelectConversation(id: string) {
    const conv = conversations.find((c) => c.id === id);
    if (!conv) return;
    setActiveId(id);
    setActiveConversationId(id);
    setMessages(conv.messages);
    setChain(conv.chain);
    setInput("");
    setPendingTx(null);
  }

  function handleDeleteConversation(id: string) {
    const next = deleteConversation(conversations, id);
    saveConversations(next);
    setConversations(next);
    if (activeId === id) {
      if (next.length > 0) {
        handleSelectConversation(next[0].id);
      } else {
        handleNewChat();
      }
    }
  }

  function handleInsertCommand(cmd: McpCommand) {
    setInput(commandHandle(cmd.tool));
    requestAnimationFrame(() => chatInputRef.current?.focus());
  }

  function handleRetry(userContent: string) {
    sendChat(userContent);
  }

  function handleSettingsChange(partial: Partial<AppSettings>) {
    const next = updateSettings(partial);
    setSettings(next);
    if (partial.defaultChain) setChain(partial.defaultChain);
  }

  function handleClearConversations() {
    clearAllConversations();
    setConversations([]);
    handleNewChat();
    setSettingsOpen(false);
  }

  if (!hydrated) {
    return (
      <div className="flex h-dvh items-center justify-center pocket-app-bg text-pocket-muted">
        <div className="flex items-center gap-3">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-pocket-accent/30 border-t-pocket-accent" />
          Loading…
        </div>
      </div>
    );
  }

  const swapMessageIndex =
    swapFlow != null
      ? messages.findLastIndex((m) => {
          if (m.role !== "assistant" || m.result?.route !== "intent-swap") return false;
          const quoteId = (m.result.output as { display?: { quoteId?: string } } | undefined)?.display
            ?.quoteId;
          return quoteId === swapFlow.quoteId;
        })
      : -1;

  return (
    <div className="relative flex h-dvh pocket-app-bg">
      <ThemeSync theme={settings.theme} />
      <div className="pointer-events-none absolute inset-0 pocket-grid-overlay" aria-hidden />
      <ConversationSidebar
        conversations={conversations}
        activeId={activeId}
        open={settings.sidebarOpen}
        onSelect={handleSelectConversation}
        onNew={handleNewChat}
        onDelete={handleDeleteConversation}
        onToggle={() => handleSettingsChange({ sidebarOpen: !settings.sidebarOpen })}
      />

      <div className="relative flex min-w-0 flex-1 flex-col">
        <header className="relative z-30 shrink-0 border-b border-pocket-border/80 pocket-glass">
          <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-pocket-cyan/40 to-transparent" />
          <div
            className={`flex flex-col gap-3 px-4 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:px-6 ${messages.length > 0 ? "py-2.5" : "py-3"}`}
          >
            <div className="flex min-w-0 shrink-0 items-center gap-3">
              {!settings.sidebarOpen && (
                <button
                  type="button"
                  onClick={() => handleSettingsChange({ sidebarOpen: true })}
                  className="rounded-lg border border-pocket-border bg-pocket-surface/80 px-2 py-1.5 text-sm text-pocket-muted shadow-sm transition-colors hover:border-pocket-accent/40 hover:text-pocket-accent"
                  aria-label="Open sidebar"
                >
                  ☰
                </button>
              )}
              <AgentMark className={messages.length > 0 ? "h-7 w-7 shadow-pocket-cyan" : "h-9 w-9 shadow-pocket-cyan"} />
              <div className="min-w-0">
                <BrandWordmark size={messages.length > 0 ? "sm" : "md"} />
                {messages.length === 0 && (
                  <p className="truncate text-xs text-pocket-muted">{BRAND.tagline}</p>
                )}
              </div>
            </div>

            <CommandsBar
              onInsertCommand={handleInsertCommand}
              disabled={loading}
              walletConnected={Boolean(walletAddress)}
              chain={chain}
            />

            <div className="flex shrink-0 items-center justify-end gap-2 sm:ml-0">
              {swapFlow && (
                <SwapStatusChip flow={swapFlow} onClick={openSwapConfirm} />
              )}
              {walletAddress && (
                <WalletChainBadge chainSlug={chain} chains={chains} chainId={walletChainId} />
              )}
              <button
                type="button"
                onClick={() => setSettingsOpen(true)}
                className="rounded-lg border border-pocket-border bg-pocket-surface/80 p-2 text-pocket-muted shadow-sm transition-all hover:border-pocket-accent/40 hover:text-pocket-accent hover:shadow-pocket"
                aria-label="Settings"
              >
                ⚙
              </button>
              <WalletButton
                apiUrl={API_URL}
                chains={chains}
                connectedAddress={walletAddress}
                onConnected={handleWalletConnected}
              />
            </div>
          </div>
        </header>

        <div ref={scrollRef} className="chat-reading-surface relative flex-1 overflow-y-auto overscroll-contain">
          <div className="mx-auto max-w-3xl px-4 py-6 pb-8 sm:px-6">
            {messages.length === 0 ? (
              <SuggestionChips
                onSelect={(s) => sendChat(s)}
                disabled={loading}
                walletConnected={Boolean(walletAddress)}
              />
            ) : (
              <div role="log" aria-live="polite" aria-relevant="additions">
                {messages.map((m, i) => {
                  const prevUser =
                    m.role === "assistant"
                      ? [...messages.slice(0, i)].reverse().find((x) => x.role === "user")
                      : undefined;
                  const prev = messages[i - 1];
                  const compactTop = i > 0 && prev?.role === m.role;
                  return (
                    <ChatMessage
                      key={i}
                      message={m}
                      chain={chain}
                      toolDetailsExpanded={settings.showToolDetailsExpanded}
                      walletConnected={Boolean(walletAddress)}
                      compactTop={compactTop}
                      onConfirmSwap={handleConfirmSwap}
                      swapFlow={i === swapMessageIndex ? swapFlow ?? undefined : undefined}
                      onOpenSwapConfirm={openSwapConfirm}
                      onDismissSwapFlow={() => setSwapFlow(null)}
                      onRetry={
                        m.role === "assistant" && prevUser
                          ? () => handleRetry(prevUser.content)
                          : undefined
                      }
                    />
                  );
                })}
                {swapFlow && swapMessageIndex === -1 && (
                  <div className="mt-5 animate-fade-in">
                    <SwapStatusBox
                      flow={swapFlow}
                      onOpenConfirm={openSwapConfirm}
                      onDismiss={() => setSwapFlow(null)}
                    />
                  </div>
                )}
                <div ref={messagesEndRef} className="h-px" aria-hidden />
              </div>
            )}
          </div>
          <ScrollToBottom visible={showScrollBtn} onClick={() => scrollToBottom()} />
        </div>

        <footer className="relative shrink-0 border-t border-pocket-border/80 pocket-glass">
          <div className="pointer-events-none absolute -top-8 inset-x-0 h-8 composer-fade" aria-hidden />
          <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-pocket-accent/25 to-transparent" />
          <div className="mx-auto max-w-3xl space-y-3 px-4 py-3 sm:px-6 sm:py-4">
            {settings.showAdvancedRpc && (
              <div className="space-y-2">
                <AdvancedRpcPanel apiUrl={API_URL} chain={chain} />
                <ToolsStatusPanel apiUrl={API_URL} />
              </div>
            )}
            <SwapExecutionModePicker
              value={settings.swapExecutionMode}
              onChange={(swapExecutionMode) => handleSettingsChange({ swapExecutionMode })}
              disabled={loading}
            />
            <ChatInput
              ref={chatInputRef}
              value={input}
              onChange={setInput}
              onSend={() => sendChat()}
              onStop={stopGeneration}
              loading={loading}
              disabled={loading}
              placeholder={
                input.trim().startsWith("@")
                  ? "Add your message after the command…"
                  : "Ask about any Pocket chain…"
              }
            />
          </div>
        </footer>
      </div>

      <SettingsDrawer
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        settings={settings}
        onChange={handleSettingsChange}
        chains={chainOptions}
        apiUrl={API_URL}
        onClearConversations={handleClearConversations}
      />

      {pendingTx && activeConvRef.current && (
        <TxConfirmModal
          preview={pendingTx}
          apiUrl={API_URL}
          chain={chain}
          walletAddress={walletAddress}
          onClose={() => setPendingTx(null)}
          onSubmitted={({ hash, explorerUrl, to, valueNative }) => {
            const link = explorerUrl ? `\n${explorerUrl}` : "";
            const chainInfo = chains.find((c) => c.slug === chain);
            void recordSubmittedTransaction(API_URL, {
              txHash: hash,
              chain,
              to,
              valueNative,
              nativeSymbol: chainInfo?.nativeSymbol,
              explorerUrl,
            }).catch(() => undefined);
            setMessages((m) => [
              ...m,
              { role: "assistant", content: `Transaction submitted: ${hash}${link}` },
            ]);
            setPendingTx(null);
          }}
        />
      )}

      {pendingSwap && (
        <SwapConfirmModal
          display={pendingSwap.display}
          quoteId={pendingSwap.quoteId}
          apiUrl={API_URL}
          walletAddress={walletAddress}
          chainId={walletChainId ?? chains.find((c) => c.slug === chain)?.chainId}
          onPhaseChange={handleSwapPhaseChange}
          onClose={() => {
            setPendingSwap(null);
            setSwapFlow((prev) =>
              prev && prev.phase !== "done" ? { ...prev, phase: "quoted" } : prev,
            );
          }}
          onComplete={({ txHash, status, intentId }) => {
            const normalized = status?.toLowerCase() ?? "";
            const completed = ["completed", "success", "successful", "filled", "executed"].includes(
              normalized,
            );
            const failed = ["failed", "error", "reverted", "cancelled", "canceled"].includes(
              normalized,
            );
            let content: string;
            if (completed) {
              content = `Swap completed${txHash ? ` — tx: \`${txHash}\`` : ""}.`;
            } else if (failed) {
              content = `Swap failed (${status ?? "unknown"}). Request a new quote to try again.`;
            } else {
              content =
                `Swap submitted to relayer${status ? ` (${status})` : ""}.` +
                (txHash ? `\nTx: \`${txHash}\`` : "") +
                `\nIntent: \`${intentId ?? "unknown"}\`` +
                (txHash
                  ? ""
                  : "\nGasless fills can take up to a minute — ask **did that swap succeed?** to check.");
            }
            setMessages((m) => [...m, { role: "assistant", content }]);
            setSwapFlow((prev) =>
              prev ? { ...prev, phase: failed ? "error" : "done", txHash, error: failed ? status : undefined } : null,
            );
            setPendingSwap(null);
          }}
        />
      )}
    </div>
  );
}
