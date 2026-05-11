"use client";

import { useTranslations } from "next-intl";
import { AlertOctagon } from "lucide-react";
import { cn } from "@/lib/utils";

export interface OffLabelInfo {
  detected: boolean;
  confidence: number;
  reason: string;
  suspectQuote?: string | null;
}

interface OffLabelWarningProps {
  info: OffLabelInfo;
  /** confidence threshold to show the warning */
  threshold?: number;
  className?: string;
}

export function OffLabelWarning({
  info,
  threshold = 0.7,
  className,
}: OffLabelWarningProps) {
  const t = useTranslations("chat");

  if (!info.detected || info.confidence < threshold) return null;

  return (
    <div
      className={cn(
        "ml-10 mt-3 rounded-lg border border-destructive/40",
        "bg-destructive/5 dark:bg-destructive/10",
        "p-3 flex items-start gap-2.5",
        className
      )}
      role="alert"
    >
      <AlertOctagon className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
      <div className="flex-1 space-y-1">
        <p className="text-xs font-semibold text-destructive">
          {t("offLabelDetected")}
        </p>
        <p className="text-xs text-foreground/80 leading-relaxed">
          {info.reason}
        </p>
        {info.suspectQuote && (
          <blockquote className="text-xs italic text-muted-foreground border-l-2 border-destructive/30 pl-2 mt-1">
            "{info.suspectQuote}"
          </blockquote>
        )}
        <p className="text-[10px] text-muted-foreground pt-1">
          {t("offLabelDescription")}
        </p>
      </div>
    </div>
  );
}
