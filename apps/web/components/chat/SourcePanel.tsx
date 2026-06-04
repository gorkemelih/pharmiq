"use client";

import { useTranslations } from "next-intl";
import { FileText, ExternalLink, BookOpen } from "lucide-react";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import type { Citation } from "./types";

interface SourcePanelProps {
  citations: Citation[];
  activeCitation?: number | null;
  onCitationFocus?: (n: number | null) => void;
}

export function SourcePanel({
  citations,
  activeCitation,
  onCitationFocus,
}: SourcePanelProps) {
  const t = useTranslations("chat");

  if (citations.length === 0) {
    return (
      <aside className="hidden lg:flex w-80 flex-col border-l bg-card/30">
        <div className="p-4 border-b">
          <h2 className="text-sm font-semibold">{t("sourcesTitle")}</h2>
        </div>
        <div className="flex-1 flex items-center justify-center p-6">
          <p className="text-xs text-muted-foreground text-center max-w-xs">
            {t("sourcesEmpty")}
          </p>
        </div>
      </aside>
    );
  }

  return (
    <aside className="hidden lg:flex w-80 flex-col border-l bg-card/30">
      <div className="p-4 border-b flex items-center justify-between">
        <h2 className="text-sm font-semibold">{t("sourcesTitle")}</h2>
        <span className="text-xs text-muted-foreground">
          {citations.length}
        </span>
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {citations.map((c) => (
          <Card
            key={c.chunkId}
            className={cn(
              "p-3 cursor-pointer transition-all border",
              activeCitation === c.n
                ? "border-primary shadow-sm bg-primary/5"
                : "hover:border-border hover:bg-secondary/30"
            )}
            onMouseEnter={() => onCitationFocus?.(c.n)}
            onMouseLeave={() => onCitationFocus?.(null)}
            onClick={() => onCitationFocus?.(c.n)}
          >
            <div className="flex items-start gap-2">
              <div
                className={cn(
                  "mt-0.5 flex h-5 min-w-5 items-center justify-center rounded text-[10px] font-semibold",
                  activeCitation === c.n
                    ? "bg-primary text-primary-foreground"
                    : "bg-primary/10 text-primary"
                )}
              >
                {c.n}
              </div>
              <div className="flex-1 min-w-0 space-y-1">
                <div className="flex items-start gap-1.5">
                  {c.kind === "paper" ? (
                    <BookOpen className="h-3.5 w-3.5 mt-0.5 text-muted-foreground shrink-0" />
                  ) : (
                    <FileText className="h-3.5 w-3.5 mt-0.5 text-muted-foreground shrink-0" />
                  )}
                  <p className="text-xs font-medium leading-tight line-clamp-2">
                    {c.documentTitle}
                  </p>
                </div>
                {c.kind === "paper" ? (
                  <div className="pl-5 space-y-0.5">
                    {(c.journal || c.year) && (
                      <p className="text-[10px] text-muted-foreground">
                        {[c.journal, c.year].filter(Boolean).join(" · ")}
                      </p>
                    )}
                    {c.authors && (
                      <p className="text-[10px] text-muted-foreground truncate">
                        {c.authors}
                      </p>
                    )}
                    {c.url && (
                      <a
                        href={c.url}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="inline-flex items-center gap-0.5 text-[10px] text-primary hover:underline"
                      >
                        {c.pmid ? `PMID ${c.pmid}` : c.doi ? "DOI" : "Kaynak"}
                        <ExternalLink className="h-2.5 w-2.5" />
                      </a>
                    )}
                  </div>
                ) : (
                  (c.pageNumber || c.sectionPath) && (
                    <p className="text-[10px] text-muted-foreground pl-5">
                      {c.pageNumber && `sayfa ${c.pageNumber}`}
                      {c.pageNumber && c.sectionPath && " · "}
                      {c.sectionPath?.slice(0, 50)}
                    </p>
                  )
                )}
                <p className="text-xs text-muted-foreground leading-relaxed pl-5 line-clamp-3">
                  {c.contentPreview}
                </p>
              </div>
            </div>
          </Card>
        ))}
      </div>
    </aside>
  );
}
