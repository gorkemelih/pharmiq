"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useTranslations } from "next-intl";
import {
  Send,
  Sparkles,
  ShieldAlert,
  Loader2,
  AlertCircle,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { MessageBubble } from "./MessageBubble";
import { SourcePanel } from "./SourcePanel";
import type { Citation, MessageMetadata } from "./types";

export function ChatInterface() {
  const t = useTranslations("chat");
  const [input, setInput] = useState("");
  const [activeCitation, setActiveCitation] = useState<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const { messages, sendMessage, status, error, stop } = useChat({
    transport: new DefaultChatTransport({
      api: "/api/chat",
    }),
  });

  // Auto-scroll on new messages / streaming tokens
  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages]);

  // Son assistant mesajının citations'ını sağ panele al
  const lastAssistantMsg = [...messages]
    .reverse()
    .find((m) => m.role === "assistant");
  const citations: Citation[] =
    (lastAssistantMsg?.metadata as MessageMetadata | undefined)?.citations ?? [];

  const onSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const trimmed = input.trim();
      if (!trimmed || status === "streaming" || status === "submitted") return;
      sendMessage({ text: trimmed });
      setInput("");
      setActiveCitation(null);
    },
    [input, status, sendMessage]
  );

  const onSampleClick = (q: string) => {
    if (status === "streaming" || status === "submitted") return;
    sendMessage({ text: q });
    setActiveCitation(null);
  };

  const sampleQueries = [t("sampleQ1"), t("sampleQ2"), t("sampleQ3")];
  const isBusy = status === "streaming" || status === "submitted";

  return (
    <div className="flex h-full">
      {/* Center */}
      <div className="flex flex-1 flex-col min-w-0">
        <div ref={scrollRef} className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-3xl px-6 py-8">
            {messages.length === 0 ? (
              <WelcomeState
                t={t}
                sampleQueries={sampleQueries}
                onSampleClick={onSampleClick}
              />
            ) : (
              <div className="space-y-6">
                {messages.map((m) => (
                  <div key={m.id}>
                    <MessageBubble
                      role={m.role as "user" | "assistant"}
                      text={messagePartsToText(m.parts)}
                      isStreaming={
                        m.role === "assistant" &&
                        m.id === messages[messages.length - 1]?.id &&
                        status === "streaming"
                      }
                      activeCitation={activeCitation}
                      onCitationClick={setActiveCitation}
                    />
                    {m.role === "assistant" && (
                      <PreMlrWatermark t={t} />
                    )}
                  </div>
                ))}
                {status === "submitted" && (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    {t("phaseRetrieving")}
                  </div>
                )}
                {error && (
                  <div className="flex items-start gap-2 p-3 rounded-md border border-destructive/40 bg-destructive/5">
                    <AlertCircle className="h-4 w-4 text-destructive mt-0.5" />
                    <div className="flex-1 text-sm">
                      <p className="font-medium text-destructive">
                        {t("phaseGenerating")} başarısız
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {error.message}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Input bar */}
        <div className="border-t bg-background">
          <div className="mx-auto max-w-3xl p-4 space-y-3">
            <form onSubmit={onSubmit} className="relative flex gap-2">
              <Input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={t("inputPlaceholder")}
                className="pr-12 h-11"
                disabled={isBusy}
                autoFocus
              />
              <Button
                type="submit"
                size="icon"
                className="absolute right-1 top-1 h-9 w-9"
                disabled={isBusy || !input.trim()}
              >
                {isBusy ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
              </Button>
            </form>
            <div className="flex items-center justify-center gap-1.5 text-[10px] text-muted-foreground">
              <ShieldAlert className="h-3 w-3" />
              <span>{t("preMlrDraftTooltip")}</span>
            </div>
          </div>
        </div>
      </div>

      <SourcePanel
        citations={citations}
        activeCitation={activeCitation}
        onCitationFocus={setActiveCitation}
      />
    </div>
  );
}

function WelcomeState({
  t,
  sampleQueries,
  onSampleClick,
}: {
  t: (k: string) => string;
  sampleQueries: string[];
  onSampleClick: (q: string) => void;
}) {
  return (
    <>
      <div className="text-center space-y-3 mb-10 animate-fade-in">
        <div className="inline-flex items-center justify-center h-12 w-12 rounded-2xl bg-primary/10 text-primary mb-2">
          <Sparkles className="h-6 w-6" />
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">
          {t("welcome")}
        </h1>
        <p className="text-muted-foreground">{t("welcomeSubtitle")}</p>
      </div>

      <div className="space-y-2 mb-8">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
          {t("sampleQueriesTitle")}
        </p>
        {sampleQueries.map((q, i) => (
          <Card
            key={i}
            onClick={() => onSampleClick(q)}
            className="p-4 cursor-pointer transition-all hover:border-primary/40 hover:shadow-sm group"
          >
            <div className="flex items-start gap-3">
              <div className="mt-0.5 h-7 w-7 rounded-md bg-secondary flex items-center justify-center text-xs font-medium text-muted-foreground group-hover:bg-primary/10 group-hover:text-primary transition-colors">
                {i + 1}
              </div>
              <span className="text-sm leading-relaxed">{q}</span>
            </div>
          </Card>
        ))}
      </div>
    </>
  );
}

function PreMlrWatermark({ t }: { t: (k: string) => string }) {
  return (
    <div className="mt-3 ml-10 inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md border border-amber-300/40 bg-amber-50 dark:bg-amber-950/30 text-amber-800 dark:text-amber-300 text-[10px] font-medium">
      <ShieldAlert className="h-3 w-3" />
      <span>{t("preMlrDraft")}</span>
    </div>
  );
}

function messagePartsToText(
  parts: Array<{ type: string; text?: string } | unknown>
): string {
  return parts
    .filter(
      (p): p is { type: "text"; text: string } =>
        typeof p === "object" &&
        p !== null &&
        (p as { type?: string }).type === "text"
    )
    .map((p) => p.text)
    .join("");
}
