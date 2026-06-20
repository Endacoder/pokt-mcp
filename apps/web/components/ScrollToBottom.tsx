"use client";

export function ScrollToBottom({ onClick, visible }: { onClick: () => void; visible: boolean }) {
  if (!visible) return null;

  return (
    <button
      type="button"
      onClick={onClick}
      className="fixed bottom-36 left-1/2 z-20 -translate-x-1/2 rounded-full border border-pocket-border/80 bg-pocket-surface/95 px-4 py-2 text-sm text-pocket-muted shadow-pocket-md backdrop-blur-sm transition-all hover:-translate-y-0.5 hover:border-pocket-accent/50 hover:text-pocket-accent hover:shadow-pocket-lg md:bottom-32"
      aria-label="Scroll to bottom"
    >
      ↓ New messages
    </button>
  );
}
