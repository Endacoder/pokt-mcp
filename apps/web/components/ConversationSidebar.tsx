"use client";

import type { Conversation } from "../lib/types";
import { AgentMark } from "./brand/AgentMark";
import { BrandWordmark } from "./brand/BrandWordmark";
import { AgentStatusBadge } from "./brand/AgentStatusBadge";
import { BRAND } from "../lib/brand";

export function ConversationSidebar({
  conversations,
  activeId,
  open,
  onSelect,
  onNew,
  onDelete,
  onToggle,
}: {
  conversations: Conversation[];
  activeId: string | null;
  open: boolean;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  onToggle: () => void;
}) {
  return (
    <>
      {open && (
        <div
          className="fixed inset-0 z-30 bg-pocket-dark/40 backdrop-blur-sm md:hidden"
          onClick={onToggle}
          aria-hidden
        />
      )}
      <aside
        className={`mcp-sidebar-bg fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-white/10 shadow-pocket-lg transition-transform md:static md:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full md:w-0 md:overflow-hidden md:border-0 md:shadow-none"
        }`}
      >
        <div className="flex items-center gap-2.5 border-b border-white/10 px-3 py-3.5">
          <AgentMark className="h-8 w-8 shrink-0 shadow-pocket-cyan" />
          <div className="min-w-0 flex-1">
            <BrandWordmark size="sm" variant="onDark" />
            <p className="truncate text-[10px] text-pocket-muted-dark">{BRAND.tagline}</p>
          </div>
          <button
            type="button"
            onClick={onNew}
            className="shrink-0 rounded-lg bg-pocket-accent px-2.5 py-1 text-xs font-semibold text-white shadow-pocket-accent transition-all hover:bg-pocket-cta-hover hover:brightness-110"
          >
            + New
          </button>
        </div>

        <div className="px-3 pt-3">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-pocket-muted-dark">Chats</p>
        </div>

        <div className="flex-1 overflow-y-auto p-2 pt-1">
          {conversations.length === 0 ? (
            <p className="px-2 py-4 text-center text-xs text-pocket-muted-dark">No conversations yet</p>
          ) : (
            <ul className="space-y-0.5">
              {conversations.map((c) => (
                <li key={c.id} className="group flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => onSelect(c.id)}
                    className={`min-w-0 flex-1 rounded-lg px-2.5 py-2 text-left text-sm transition-all ${
                      c.id === activeId
                        ? "border-l-2 border-pocket-cyan bg-pocket-gradient-dark font-medium text-white shadow-sm"
                        : "border-l-2 border-transparent text-pocket-muted-dark hover:bg-white/5 hover:text-white"
                    }`}
                  >
                    <span className="block truncate">{c.title}</span>
                    <span className="block truncate text-[10px] uppercase tracking-wide opacity-60">{c.chain}</span>
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDelete(c.id);
                    }}
                    className="rounded p-1 text-pocket-muted-dark opacity-0 transition-opacity hover:text-pocket-error group-hover:opacity-100"
                    aria-label={`Delete ${c.title}`}
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="border-t border-white/10 px-3 py-3">
          <AgentStatusBadge online />
        </div>
      </aside>
    </>
  );
}
