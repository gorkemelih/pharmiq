"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { DocumentUploader } from "./DocumentUploader";
import { DocumentList } from "./DocumentList";

export function LibraryClient() {
  const t = useTranslations("library");
  const [refreshKey, setRefreshKey] = useState(0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-sm text-muted-foreground mt-1">
          PDF SmPC, çalışma raporu veya makaleleri yükleyin. Otomatik parse,
          chunk ve embed edilir.
        </p>
      </div>

      <DocumentUploader onUploaded={() => setRefreshKey((k) => k + 1)} />

      <DocumentList refreshTrigger={refreshKey} />
    </div>
  );
}
