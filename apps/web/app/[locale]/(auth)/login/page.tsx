import { setRequestLocale, getTranslations } from "next-intl/server";
import { Building2, ShieldCheck } from "lucide-react";
import { Logo } from "@/components/shared/Logo";
import { LanguageSwitcher } from "@/components/shared/LanguageSwitcher";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Link } from "@/i18n/routing";

export default async function LoginPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("auth");
  const tc = await getTranslations("common");

  return (
    <div className="relative flex min-h-screen flex-col bg-gradient-to-b from-background via-secondary/30 to-background">
      <header className="flex items-center justify-between p-6">
        <Logo />
        <LanguageSwitcher />
      </header>

      <main className="flex flex-1 items-center justify-center px-4">
        <div className="w-full max-w-md animate-fade-in">
          <Card className="border-border/50 shadow-lg">
            <CardContent className="p-8 space-y-6">
              <div className="text-center space-y-2">
                <h1 className="text-2xl font-semibold tracking-tight">
                  {t("loginTitle")}
                </h1>
                <p className="text-sm text-muted-foreground">
                  {t("loginSubtitle")}
                </p>
              </div>

              <div className="space-y-3">
                <Link href="/chat">
                  <Button className="w-full" size="lg">
                    <Building2 className="h-4 w-4" />
                    {t("ssoButton")}
                  </Button>
                </Link>
                <Link href="/chat">
                  <Button variant="outline" className="w-full" size="lg">
                    {t("ssoButtonAlt")}
                  </Button>
                </Link>
              </div>

              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-card px-2 text-muted-foreground">
                    or
                  </span>
                </div>
              </div>

              <Link href="/chat">
                <Button variant="ghost" className="w-full">
                  {t("emailLogin")}
                </Button>
              </Link>

              <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
                <ShieldCheck className="h-3.5 w-3.5 text-clinical" />
                <span>{t("demoNote")}</span>
              </div>
            </CardContent>
          </Card>

          <p className="mt-6 text-center text-xs text-muted-foreground">
            {tc("appName")} · EU-Hosted · MLR-Aware · GDPR/KVKK Compliant
          </p>
        </div>
      </main>
    </div>
  );
}
