"use client";

import { useCallback, useState } from "react";
import { useDropzone } from "react-dropzone";
import { useTranslations } from "next-intl";
import { Upload, FileUp, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface UploaderProps {
  onUploaded?: (id: string) => void;
}

interface PendingUpload {
  name: string;
  progress: number; // 0-100
  error?: string;
}

export function DocumentUploader({ onUploaded }: UploaderProps) {
  const t = useTranslations("library");
  const [pending, setPending] = useState<PendingUpload[]>([]);

  const upload = useCallback(
    async (file: File) => {
      const entry: PendingUpload = { name: file.name, progress: 0 };
      setPending((prev) => [...prev, entry]);

      try {
        const formData = new FormData();
        formData.append("file", file);

        const res = await fetch("/api/documents/upload", {
          method: "POST",
          body: formData,
        });

        if (!res.ok) {
          const errBody = await res.json().catch(() => ({}));
          throw new Error(errBody.error || `HTTP ${res.status}`);
        }

        const data = await res.json();

        setPending((prev) =>
          prev.map((p) =>
            p.name === file.name ? { ...p, progress: 100 } : p
          )
        );

        // Listeden 1 sn sonra çıkar
        setTimeout(() => {
          setPending((prev) => prev.filter((p) => p.name !== file.name));
        }, 1000);

        onUploaded?.(data.id);
      } catch (err) {
        setPending((prev) =>
          prev.map((p) =>
            p.name === file.name
              ? { ...p, error: err instanceof Error ? err.message : "Hata" }
              : p
          )
        );
      }
    },
    [onUploaded]
  );

  const onDrop = useCallback(
    (acceptedFiles: File[]) => {
      acceptedFiles.forEach(upload);
    },
    [upload]
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { "application/pdf": [".pdf"] },
    maxSize: 50 * 1024 * 1024,
    multiple: true,
  });

  return (
    <div className="space-y-3">
      <div
        {...getRootProps()}
        className={cn(
          "border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors",
          "hover:bg-secondary/50",
          isDragActive
            ? "border-primary bg-primary/5"
            : "border-border bg-secondary/30"
        )}
      >
        <input {...getInputProps()} />
        <div className="flex flex-col items-center gap-3">
          <div className="h-12 w-12 rounded-full bg-secondary flex items-center justify-center">
            {isDragActive ? (
              <FileUp className="h-6 w-6 text-primary" />
            ) : (
              <Upload className="h-6 w-6 text-muted-foreground" />
            )}
          </div>
          <div>
            <p className="text-sm font-medium">{t("uploadDropzone")}</p>
            <p className="text-xs text-muted-foreground mt-1">
              {t("uploadFormat")}
            </p>
          </div>
        </div>
      </div>

      {pending.length > 0 && (
        <div className="space-y-2">
          {pending.map((p) => (
            <div
              key={p.name}
              className={cn(
                "flex items-center gap-3 px-3 py-2 rounded-md border text-sm",
                p.error
                  ? "border-destructive/40 bg-destructive/5"
                  : "border-border bg-secondary/30"
              )}
            >
              {p.error ? (
                <span className="text-destructive">✗</span>
              ) : p.progress < 100 ? (
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              ) : (
                <span className="text-emerald-600">✓</span>
              )}
              <span className="flex-1 truncate">{p.name}</span>
              <span className="text-xs text-muted-foreground">
                {p.error ?? (p.progress === 100 ? "Yüklendi" : "Yükleniyor...")}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
