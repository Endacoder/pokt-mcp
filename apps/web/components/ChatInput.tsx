"use client";

import { useCallback, useEffect, useRef } from "react";

function SendIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4 rotate-180" aria-hidden>
      <path
        d="m5 12 14-7-4 7 4 7-14-7Z"
        fill="#ffffff"
        stroke="none"
      />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4" aria-hidden>
      <rect x="6" y="6" width="12" height="12" rx="1" />
    </svg>
  );
}

export function ChatInput({
  value,
  onChange,
  onSend,
  onStop,
  loading,
  disabled,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  onStop?: () => void;
  loading?: boolean;
  disabled?: boolean;
  placeholder?: string;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const resize = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, []);

  useEffect(() => {
    resize();
  }, [value, resize]);

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Escape" && loading && onStop) {
      e.preventDefault();
      onStop();
      return;
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!disabled && !loading && value.trim()) onSend();
    }
  }

  const inputDisabled = disabled && !loading;

  return (
    <div className="space-y-2">
      <div className="pocket-gradient-border relative flex items-end gap-2 rounded-3xl bg-pocket-surface p-2 shadow-pocket-lg transition-shadow focus-within:shadow-pocket-glow">
        <textarea
          ref={textareaRef}
          rows={1}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={inputDisabled}
          placeholder={placeholder}
          aria-label="Message input"
          className="max-h-[200px] min-h-[48px] flex-1 resize-none bg-transparent px-3 py-3 text-[0.9375rem] leading-relaxed text-pocket-foreground placeholder:text-pocket-muted focus:outline-none disabled:opacity-50"
        />
        {loading && onStop ? (
          <button
            type="button"
            onClick={onStop}
            aria-label="Stop generation"
            title="Stop (Esc)"
            className="mb-0.5 mr-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-pocket-error-border bg-pocket-error-surface text-pocket-error transition-colors hover:border-pocket-error hover:bg-pocket-error/10"
          >
            <StopIcon />
          </button>
        ) : (
          <button
            type="button"
            onClick={onSend}
            disabled={disabled || !value.trim()}
            aria-label="Send message"
            className="mb-0.5 mr-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-pocket-gradient text-white shadow-pocket-accent transition-all hover:brightness-110 disabled:cursor-not-allowed disabled:bg-pocket-elevated disabled:shadow-none disabled:[&_path]:fill-pocket-muted"
          >
            <SendIcon />
          </button>
        )}
      </div>
      <p className="text-center text-[11px] text-pocket-muted/80">
        {loading ? (
          <>Generating… press <kbd className="rounded border border-pocket-border bg-pocket-elevated px-1 py-0.5 font-mono text-[10px]">Esc</kbd> to stop</>
        ) : (
          <>
            <kbd className="rounded border border-pocket-border bg-pocket-elevated px-1 py-0.5 font-mono text-[10px]">Enter</kbd> to send ·{" "}
            <kbd className="rounded border border-pocket-border bg-pocket-elevated px-1 py-0.5 font-mono text-[10px]">Shift+Enter</kbd> for new line
          </>
        )}
      </p>
    </div>
  );
}
