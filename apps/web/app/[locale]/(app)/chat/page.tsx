import { setRequestLocale, getTranslations } from "next-intl/server";
import { Send, Sparkles, FileSearch, Globe2, ShieldAlert } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";

export default async function ChatPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("chat");

  const sampleQueries = [t("sampleQ1"), t("sampleQ2"), t("sampleQ3")];

  return (
    <div className="flex h-full">
      {/* Center: chat area */}
      <div className="flex flex-1 flex-col">
        <ScrollArea className="flex-1">
          <div className="mx-auto max-w-3xl px-6 py-12">
            {/* Welcome state */}
            <div className="text-center space-y-3 mb-10 animate-fade-in">
              <div className="inline-flex items-center justify-center h-12 w-12 rounded-2xl bg-primary/10 text-primary mb-2">
                <Sparkles className="h-6 w-6" />
              </div>
              <h1 className="text-2xl font-semibold tracking-tight">
                {t("welcome")}
              </h1>
              <p className="text-muted-foreground">{t("welcomeSubtitle")}</p>
            </div>

            {/* Sample queries */}
            <div className="space-y-2 mb-8">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
                {t("sampleQueriesTitle")}
              </p>
              {sampleQueries.map((q, i) => (
                <Card
                  key={i}
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
          </div>
        </ScrollArea>

        {/* Input bar */}
        <div className="border-t bg-background">
          <div className="mx-auto max-w-3xl p-4 space-y-3">
            <div className="flex items-center gap-4 text-xs">
              <label className="flex items-center gap-2 cursor-pointer text-muted-foreground hover:text-foreground transition-colors">
                <input
                  type="checkbox"
                  defaultChecked
                  className="h-3.5 w-3.5 rounded border-input"
                />
                <FileSearch className="h-3.5 w-3.5" />
                {t("searchInternal")}
              </label>
              <label className="flex items-center gap-2 cursor-pointer text-muted-foreground hover:text-foreground transition-colors">
                <input
                  type="checkbox"
                  defaultChecked
                  className="h-3.5 w-3.5 rounded border-input"
                />
                <Globe2 className="h-3.5 w-3.5" />
                {t("searchPubMed")}
              </label>
            </div>
            <form className="relative flex gap-2">
              <Input
                placeholder={t("inputPlaceholder")}
                className="pr-12 h-11"
              />
              <Button
                type="submit"
                size="icon"
                className="absolute right-1 top-1 h-9 w-9"
                disabled
              >
                <Send className="h-4 w-4" />
              </Button>
            </form>
            <div className="flex items-center justify-center gap-1.5 text-[10px] text-muted-foreground">
              <ShieldAlert className="h-3 w-3" />
              <span>
                {t("preMlrDraftTooltip")}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Right: source panel placeholder */}
      <aside className="hidden lg:flex w-72 flex-col border-l bg-card/30">
        <div className="p-4 border-b">
          <h2 className="text-sm font-semibold">{t("sourcesTitle")}</h2>
        </div>
        <div className="flex-1 flex items-center justify-center p-6">
          <p className="text-xs text-muted-foreground text-center max-w-xs">
            {t("sourcesEmpty")}
          </p>
        </div>
      </aside>
    </div>
  );
}
