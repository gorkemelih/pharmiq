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
  Brain,
  Search,
  Pencil,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { MessageBubble } from "./MessageBubble";
import { SourcePanel } from "./SourcePanel";
import { OffLabelWarning, type OffLabelInfo } from "./OffLabelWarning";
import { CitationValidationBadge } from "./CitationValidationBadge";
import type { Citation, MessageMetadata } from "./types";

type OffLabelState = OffLabelInfo | "pending" | "skipped";

export function ChatInterface() {
  const t = useTranslations("chat");
  const [input, setInput] = useState("");
  const [activeCitation, setActiveCitation] = useState<number | null>(null);
  const [offLabelMap, setOffLabelMap] = useState<Record<string, OffLabelState>>(
    {}
  );
  const scrollRef = useRef<HTMLDivElement>(null);

  const { messages, sendMessage, status, error } = useChat({
    transport: new DefaultChatTransport({
      api: "/api/chat",
    }),
  });

  // Auto-scroll
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

  // Off-label detection: stream tamamlandığında her assistant mesajı için bir kez çağır
  useEffect(() => {
    if (status !== "ready") return;
    const finished = messages.filter((m) => m.role === "assistant");
    for (const m of finished) {
      if (offLabelMap[m.id]) continue; // zaten check edildi/yapılıyor

      const text = partsToText(m.parts);
      if (!text || text.length < 80) {
        setOffLabelMap((p) => ({ ...p, [m.id]: "skipped" }));
        continue;
      }

      // Önceki user msg'sini bul
      const idx = messages.findIndex((x) => x.id === m.id);
      const prevUser = messages.slice(0, idx).reverse().find((x) => x.role === "user");
      if (!prevUser) continue;
      const question = partsToText(prevUser.parts);

      const meta = m.metadata as MessageMetadata | undefined;
      const chunkIds = meta?.citations?.map((c) => c.chunkId) ?? [];

      setOffLabelMap((p) => ({ ...p, [m.id]: "pending" }));

      fetch("/api/chat/off-label", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, answer: text, chunkIds }),
      })
        .then((r) => r.json())
        .then((info: OffLabelInfo) => {
          setOffLabelMap((p) => ({ ...p, [m.id]: info }));
        })
        .catch(() => {
          setOffLabelMap((p) => ({ ...p, [m.id]: "skipped" }));
        });
    }
  }, [status, messages, offLabelMap]);

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

  // Keyboard shortcut: Cmd/Ctrl + K → new chat (clear input + scroll top)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setInput("");
        scrollRef.current?.scrollTo({ top: 0 });
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const sampleQueries = [t("sampleQ1"), t("sampleQ2"), t("sampleQ3")];
  const isBusy = status === "streaming" || status === "submitted";

  return (
    <div className="flex h-full">
      {/* Center */}
      <div className="flex flex-1 flex-col min-w-0">
        <div ref={scrollRef} className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-3xl px-4 sm:px-6 py-8">
            {messages.length === 0 ? (
              <WelcomeState
                t={t}
                sampleQueries={sampleQueries}
                onSampleClick={onSampleClick}
              />
            ) : (
              <div className="space-y-6">
                {messages.map((m) => {
                  const off = offLabelMap[m.id];
                  const isStreamingMsg =
                    m.role === "assistant" &&
                    m.id === messages[messages.length - 1]?.id &&
                    status === "streaming";
                  return (
                    <div key={m.id}>
                      <MessageBubble
                        role={m.role as "user" | "assistant"}
                        text={partsToText(m.parts)}
                        isStreaming={isStreamingMsg}
                        activeCitation={activeCitation}
                        onCitationClick={setActiveCitation}
                      />
                      {m.role === "assistant" && (
                        <>
                          <PreMlrWatermark t={t} />
                          {(() => {
                            const meta = m.metadata as
                              | MessageMetadata
                              | undefined;
                            return meta?.citationValidation ? (
                              <div>
                                <CitationValidationBadge
                                  validation={meta.citationValidation}
                                  language={meta.language ?? "tr"}
                                />
                              </div>
                            ) : null;
                          })()}
                          {off &&
                            typeof off === "object" &&
                            "detected" in off && (
                              <OffLabelWarning info={off} />
                            )}
                        </>
                      )}
                    </div>
                  );
                })}
                <PhaseIndicator status={status} t={t} />
                {error && (
                  <div className="flex items-start gap-2 p-3 rounded-md border border-destructive/40 bg-destructive/5">
                    <AlertCircle className="h-4 w-4 text-destructive mt-0.5" />
                    <div className="flex-1 text-sm">
                      <p className="font-medium text-destructive">
                        Yanıt üretilemedi
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
          <div className="mx-auto max-w-3xl px-4 sm:px-6 py-4 space-y-3">
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
                aria-label={t("send")}
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

function PhaseIndicator({
  status,
  t,
}: {
  status: string;
  t: (k: string) => string;
}) {
  if (status === "ready" || status === "error") return null;
  const isSubmitted = status === "submitted";
  return (
    <div className="flex items-center gap-3 text-xs text-muted-foreground pl-10">
      <div className="flex items-center gap-1.5">
        <Brain className="h-3.5 w-3.5 text-primary/60" />
        <span className={isSubmitted ? "text-foreground" : "line-through opacity-50"}>
          {t("phaseUnderstanding")}
        </span>
      </div>
      <span className="opacity-40">›</span>
      <div className="flex items-center gap-1.5">
        <Search className="h-3.5 w-3.5 text-primary/60" />
        <span className={isSubmitted ? "text-foreground" : "line-through opacity-50"}>
          {t("phaseRetrieving")}
        </span>
      </div>
      <span className="opacity-40">›</span>
      <div className="flex items-center gap-1.5">
        <Pencil className="h-3.5 w-3.5 text-primary/60" />
        <span className={status === "streaming" ? "text-foreground" : "opacity-50"}>
          {t("phaseGenerating")}
        </span>
      </div>
      <Loader2 className="h-3 w-3 animate-spin ml-1" />
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

function partsToText(
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
