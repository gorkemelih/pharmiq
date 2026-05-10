import { setRequestLocale, getTranslations } from "next-intl/server";
import { Upload, Globe, FileText, FolderOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export default async function LibraryPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("library");

  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto max-w-5xl px-6 py-8 space-y-6">
        <div className="flex items-end justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              {t("title")}
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              0 {t("statusReady").toLowerCase()} · 0 chunks · 0 B
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm">
              <Globe className="h-4 w-4" />
              {t("importPubMed")}
            </Button>
            <Button size="sm">
              <Upload className="h-4 w-4" />
              {t("uploadButton")}
            </Button>
          </div>
        </div>

        {/* Empty state */}
        <Card className="border-dashed border-2 bg-secondary/30">
          <div className="flex flex-col items-center justify-center py-16 px-6 text-center space-y-4">
            <div className="h-12 w-12 rounded-full bg-secondary flex items-center justify-center">
              <FolderOpen className="h-6 w-6 text-muted-foreground" />
            </div>
            <div className="space-y-1.5 max-w-sm">
              <h3 className="text-base font-medium">{t("empty")}</h3>
              <p className="text-sm text-muted-foreground">
                {t("emptyDescription")}
              </p>
            </div>
            <Button variant="outline" size="sm">
              <Upload className="h-4 w-4" />
              {t("uploadButton")}
            </Button>
          </div>
        </Card>

        {/* Reserved area for document list (Hafta 2'de doldurulacak) */}
        <div className="text-xs text-muted-foreground text-center py-4">
          <FileText className="inline h-3.5 w-3.5 mr-1" />
          Hafta 2: Yüklü dokümanlar burada listelenecek (drag-drop + işlem
          durumu)
        </div>
      </div>
    </div>
  );
}
