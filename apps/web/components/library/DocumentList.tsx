"use client";

import { useEffect, useState, useCallback } from "react";
import { useTranslations } from "next-intl";
import { FileText, Loader2, CheckCircle2, AlertCircle, FolderOpen } from "lucide-react";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";

export interface DocumentRow {
  id: string;
  title: string;
  status: "pending" | "processing" | "ready" | "failed";
  language: string | null;
  documentType: string | null;
  fileSizeBytes: number | null;
  createdAt: string;
  processedAt: string | null;
  chunkCount: number;
  metadata: Record<string, unknown>;
}

interface DocumentListProps {
  refreshTrigger?: number;
}

const POLL_INTERVAL_MS = 2000;

export function DocumentList({ refreshTrigger = 0 }: DocumentListProps) {
  const t = useTranslations("library");
  const [docs, setDocs] = useState<DocumentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchDocs = useCallback(async () => {
    try {
      const res = await fetch("/api/documents", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setDocs(data.documents);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Yüklenemedi");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDocs();
  }, [fetchDocs, refreshTrigger]);

  // İşleniyor olan dokümanlar varsa polling
  useEffect(() => {
    const hasInProgress = docs.some(
      (d) => d.status === "pending" || d.status === "processing"
    );
    if (!hasInProgress) return;

    const id = setInterval(fetchDocs, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [docs, fetchDocs]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <Card className="p-6 border-destructive/40">
        <p className="text-sm text-destructive">{error}</p>
      </Card>
    );
  }

  if (docs.length === 0) {
    return (
      <Card className="border-dashed border-2 bg-secondary/20">
        <div className="flex flex-col items-center justify-center py-12 px-6 text-center space-y-3">
          <div className="h-12 w-12 rounded-full bg-secondary flex items-center justify-center">
            <FolderOpen className="h-6 w-6 text-muted-foreground" />
          </div>
          <div className="space-y-1 max-w-sm">
            <h3 className="text-sm font-medium">{t("empty")}</h3>
            <p className="text-xs text-muted-foreground">
              {t("emptyDescription")}
            </p>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-2">
      {docs.map((d) => (
        <Card key={d.id} className="p-4 hover:bg-secondary/30 transition-colors">
          <div className="flex items-start gap-3">
            <div className="mt-0.5">
              <FileText className="h-5 w-5 text-muted-foreground" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-start justify-between gap-3">
                <h4 className="text-sm font-medium truncate">{d.title}</h4>
                <StatusBadge status={d.status} t={t} />
              </div>
              <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                {d.language && (
                  <span className="uppercase">
                    {d.language === "tr" ? "🇹🇷" : "🇬🇧"} {d.language}
                  </span>
                )}
                {d.status === "ready" && (
                  <>
                    <span>·</span>
                    <span>{d.chunkCount} chunk</span>
                  </>
                )}
                <span>·</span>
                <span>{formatBytes(d.fileSizeBytes)}</span>
                <span>·</span>
                <span>{formatRelative(d.createdAt)}</span>
              </div>
              {d.status === "failed" && Boolean(d.metadata?.error) && (
                <p className="text-xs text-destructive mt-2">
                  {String((d.metadata as { error?: string }).error).slice(0, 200)}
                </p>
              )}
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}

function StatusBadge({
  status,
  t,
}: {
  status: DocumentRow["status"];
  t: (key: string) => string;
}) {
  const map = {
    ready: {
      icon: <CheckCircle2 className="h-3.5 w-3.5" />,
      label: t("statusReady"),
      cls: "text-emerald-700 bg-emerald-50 border-emerald-200 dark:text-emerald-300 dark:bg-emerald-950/40 dark:border-emerald-900",
    },
    processing: {
      icon: <Loader2 className="h-3.5 w-3.5 animate-spin" />,
      label: t("statusProcessing"),
      cls: "text-blue-700 bg-blue-50 border-blue-200 dark:text-blue-300 dark:bg-blue-950/40 dark:border-blue-900",
    },
    pending: {
      icon: <Loader2 className="h-3.5 w-3.5 animate-spin" />,
      label: t("statusPending"),
      cls: "text-muted-foreground bg-secondary border-border",
    },
    failed: {
      icon: <AlertCircle className="h-3.5 w-3.5" />,
      label: t("statusFailed"),
      cls: "text-destructive bg-destructive/10 border-destructive/30",
    },
  };
  const c = map[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-xs font-medium whitespace-nowrap",
        c.cls
      )}
    >
      {c.icon}
      {c.label}
    </span>
  );
}

function formatBytes(bytes: number | null): string {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  let n = bytes;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(n < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

function formatRelative(iso: string): string {
  const d = new Date(iso);
  const diffMs = Date.now() - d.getTime();
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return "az önce";
  if (mins < 60) return `${mins} dk önce`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} sa önce`;
  const days = Math.floor(hours / 24);
  return `${days} gün önce`;
}
