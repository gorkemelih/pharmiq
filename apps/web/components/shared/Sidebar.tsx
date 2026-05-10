"use client";

import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/routing";
import {
  MessageSquarePlus,
  Library,
  Clock,
  Settings,
  ShieldCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Logo } from "./Logo";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";

interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

export function Sidebar() {
  const t = useTranslations("nav");
  const pathname = usePathname();

  const navItems: NavItem[] = [
    { href: "/chat", label: t("newChat"), icon: MessageSquarePlus },
    { href: "/library", label: t("library"), icon: Library },
  ];

  // Demo: 3 örnek geçmiş sohbet (Hafta 4'te gerçek DB'den gelecek)
  const sampleHistory = [
    { id: "1", title: "Ramipril nefropati" },
    { id: "2", title: "Cushing pasireotid" },
    { id: "3", title: "Bevacizumab GBM" },
  ];

  return (
    <aside className="flex h-screen w-60 flex-col border-r bg-card">
      <div className="flex h-14 items-center px-4 border-b">
        <Logo />
      </div>

      <nav className="flex flex-col gap-1 p-3">
        {navItems.map((item) => {
          const isActive = pathname.startsWith(item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors",
                isActive
                  ? "bg-primary/10 text-primary font-medium"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground"
              )}
            >
              <Icon className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <Separator />

      <div className="flex-1 overflow-hidden">
        <div className="px-4 py-2 flex items-center gap-2 text-xs font-medium text-muted-foreground">
          <Clock className="h-3 w-3" />
          {t("history")}
        </div>
        <ScrollArea className="h-full px-2">
          <div className="flex flex-col gap-0.5 pb-4">
            {sampleHistory.map((conv) => (
              <button
                key={conv.id}
                className="flex items-center gap-2 rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-foreground text-left truncate transition-colors"
              >
                <span className="truncate">{conv.title}</span>
              </button>
            ))}
          </div>
        </ScrollArea>
      </div>

      <Separator />

      <div className="p-3 space-y-1">
        <Link
          href="/chat"
          className="flex items-center gap-2.5 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
        >
          <Settings className="h-4 w-4" />
          {t("settings")}
        </Link>
        <div className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
          <ShieldCheck className="h-3 w-3 text-clinical" />
          <span>EU Region · MLR-Aware</span>
        </div>
      </div>
    </aside>
  );
}
