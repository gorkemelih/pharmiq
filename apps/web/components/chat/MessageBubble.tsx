"use client";

import { memo, useMemo, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import { Sparkles, User } from "lucide-react";
import { cn } from "@/lib/utils";
import { CitationChip } from "./CitationChip";

interface MessageBubbleProps {
  role: "user" | "assistant" | "system";
  text: string;
  isStreaming?: boolean;
  activeCitation?: number | null;
  onCitationClick?: (n: number) => void;
}

// Match footnote-style citations like [^1] or [^12]
const CITATION_RE = /\[\^(\d+)\]/g;

/** Replace [^N] occurrences inside a string with <CitationChip/> elements */
function renderTextWithCitations(
  text: string,
  activeCitation: number | null | undefined,
  onClick?: (n: number) => void
): ReactNode[] {
  const parts: ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  CITATION_RE.lastIndex = 0;
  while ((match = CITATION_RE.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    const n = parseInt(match[1], 10);
    parts.push(
      <CitationChip
        key={`${match.index}-${n}`}
        n={n}
        active={activeCitation === n}
        onClick={onClick}
      />
    );
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }
  return parts;
}

function transformChildren(
  children: ReactNode,
  activeCitation: number | null | undefined,
  onClick?: (n: number) => void
): ReactNode {
  if (typeof children === "string") {
    return renderTextWithCitations(children, activeCitation, onClick);
  }
  if (Array.isArray(children)) {
    return children.map((child, i) => {
      if (typeof child === "string") {
        return (
          <span key={i}>
            {renderTextWithCitations(child, activeCitation, onClick)}
          </span>
        );
      }
      return child;
    });
  }
  return children;
}

export const MessageBubble = memo(function MessageBubble({
  role,
  text,
  isStreaming,
  activeCitation,
  onCitationClick,
}: MessageBubbleProps) {
  const components: Components = useMemo(
    () => ({
      p: ({ children }) => (
        <p className="leading-7 [&:not(:first-child)]:mt-3">
          {transformChildren(children, activeCitation, onCitationClick)}
        </p>
      ),
      li: ({ children }) => (
        <li className="leading-7">
          {transformChildren(children, activeCitation, onCitationClick)}
        </li>
      ),
      strong: ({ children }) => (
        <strong className="font-semibold">{children}</strong>
      ),
      h1: ({ children }) => (
        <h1 className="text-base font-semibold mt-4 mb-2">{children}</h1>
      ),
      h2: ({ children }) => (
        <h2 className="text-sm font-semibold mt-3 mb-1.5">{children}</h2>
      ),
      h3: ({ children }) => (
        <h3 className="text-sm font-medium mt-3 mb-1.5">{children}</h3>
      ),
      ul: ({ children }) => (
        <ul className="list-disc pl-5 my-2 space-y-1">{children}</ul>
      ),
      ol: ({ children }) => (
        <ol className="list-decimal pl-5 my-2 space-y-1">{children}</ol>
      ),
      code: ({ children }) => (
        <code className="px-1 py-0.5 rounded bg-secondary text-xs font-mono">
          {children}
        </code>
      ),
    }),
    [activeCitation, onCitationClick]
  );

  if (role === "user") {
    return (
      <div className="flex gap-3 group">
        <div className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-secondary text-muted-foreground">
          <User className="h-4 w-4" />
        </div>
        <div className="flex-1 pt-1 text-sm leading-7 whitespace-pre-wrap">
          {text}
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-3 group">
      <div className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
        <Sparkles className="h-4 w-4" />
      </div>
      <div
        className={cn(
          "flex-1 pt-1 text-sm prose prose-sm max-w-none",
          "prose-headings:font-semibold prose-p:my-0 prose-li:my-0"
        )}
      >
        <ReactMarkdown components={components}>{text}</ReactMarkdown>
        {isStreaming && (
          <span className="inline-block w-1.5 h-4 ml-0.5 bg-primary/40 animate-pulse align-middle" />
        )}
      </div>
    </div>
  );
});
