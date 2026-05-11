"use client";

import { cn } from "@/lib/utils";

interface CitationChipProps {
  n: number;
  active?: boolean;
  onClick?: (n: number) => void;
}

export function CitationChip({ n, active, onClick }: CitationChipProps) {
  return (
    <button
      type="button"
      onClick={() => onClick?.(n)}
      className={cn(
        "inline-flex items-center justify-center align-baseline",
        "min-w-[1.4rem] h-5 px-1 mx-0.5",
        "text-[10px] font-semibold rounded-md",
        "transition-all duration-150",
        "border",
        active
          ? "bg-primary text-primary-foreground border-primary shadow-sm"
          : "bg-primary/10 text-primary border-primary/20 hover:bg-primary/20 hover:border-primary/40"
      )}
      title={`Kaynak ${n}`}
    >
      {n}
    </button>
  );
}
