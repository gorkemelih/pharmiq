/**
 * Citation doğrulama rozeti — asistan mesajının altında görünür.
 * Server'ın ürettiği citationValidation metadata'sını (lib/llm/citations.ts)
 * kullanıcıya görünür kılar: ✓ doğrulandı / ⚠ geçersiz atıf / kaynaksız cümle.
 */

import { ShieldCheck, ShieldAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CitationValidation } from "@/lib/llm/citations";

function buildLabel(v: CitationValidation, lang: "tr" | "en"): string {
  const tr = lang === "tr";

  if (v.ok) {
    return tr
      ? `${v.valid.length} atıf doğrulandı · kapsam %${Math.round(v.coverage * 100)}`
      : `${v.valid.length} citations verified · ${Math.round(v.coverage * 100)}% coverage`;
  }

  const parts: string[] = [];
  if (v.invalid.length > 0) {
    parts.push(
      tr
        ? `${v.invalid.length} geçersiz atıf (^${v.invalid.join(", ^")})`
        : `${v.invalid.length} invalid citation${
            v.invalid.length > 1 ? "s" : ""
          } (^${v.invalid.join(", ^")})`
    );
  }
  if (v.uncitedSentences > 0) {
    parts.push(
      tr
        ? `${v.uncitedSentences} cümle kaynaksız`
        : `${v.uncitedSentences} uncited sentence${
            v.uncitedSentences > 1 ? "s" : ""
          }`
    );
  }
  if (v.valid.length === 0) {
    parts.push(tr ? "geçerli atıf yok" : "no valid citations");
  }
  return (tr ? "Doğrulama: " : "Check: ") + parts.join(" · ");
}

export function CitationValidationBadge({
  validation,
  language = "tr",
}: {
  validation: CitationValidation;
  language?: "tr" | "en";
}) {
  const ok = validation.ok;
  const Icon = ok ? ShieldCheck : ShieldAlert;

  return (
    <div
      className={cn(
        "mt-2 ml-10 inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md border text-[10px] font-medium",
        ok
          ? "border-emerald-300/40 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300"
          : "border-rose-300/40 bg-rose-50 dark:bg-rose-950/30 text-rose-700 dark:text-rose-300"
      )}
      title={
        language === "tr"
          ? "Atıflar kaynak kümesine karşı yapısal olarak doğrulandı (aralık + kapsam)"
          : "Citations structurally validated against the source set (range + coverage)"
      }
    >
      <Icon className="h-3 w-3" />
      <span>{buildLabel(validation, language)}</span>
    </div>
  );
}
