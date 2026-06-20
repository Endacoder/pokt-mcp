import { BRAND } from "../../lib/brand";

export function AgentStatusBadge({ online = true }: { online?: boolean }) {
  if (!online) return null;

  return (
    <div className="flex items-center gap-2 rounded-lg bg-white/5 px-2.5 py-2">
      <span className="relative flex h-2 w-2 shrink-0">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-pocket-cyan opacity-50" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-pocket-cyan" />
      </span>
      <span className="text-[10px] font-semibold uppercase tracking-wider text-pocket-muted-dark">
        {BRAND.agentOnline}
      </span>
    </div>
  );
}
