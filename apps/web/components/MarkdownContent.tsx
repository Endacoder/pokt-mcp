"use client";

import type { ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export function MarkdownContent({ content }: { content: string; chain?: string }) {
  return (
    <div className="prose prose-sm max-w-none break-words text-pocket-foreground prose-p:my-1 prose-pre:my-2 prose-ul:my-1 prose-ol:my-1 prose-headings:my-2 prose-headings:text-pocket-foreground prose-a:text-pocket-accent prose-a:no-underline hover:prose-a:underline prose-code:rounded prose-code:bg-pocket-elevated prose-code:px-1 prose-code:py-0.5 prose-code:text-pocket-accent prose-code:before:content-none prose-code:after:content-none prose-pre:bg-pocket-elevated prose-pre:border prose-pre:border-pocket-border">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noreferrer">
              {children}
            </a>
          ),
          p: ({ children }) => {
            if (typeof children === "string") {
              return <p>{renderInlineLinks(children)}</p>;
            }
            return <p>{children}</p>;
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

function renderInlineLinks(text: string): ReactNode {
  const parts = text.split(/(\b0x[a-fA-F0-9]{40,64}\b)/g);
  if (parts.length === 1) return text;
  return parts.map((part, i) =>
    /^0x[a-fA-F0-9]{40,64}$/.test(part) ? (
      <span key={i} className="font-mono text-xs text-pocket-accent">
        {part}
      </span>
    ) : (
      part
    ),
  );
}
