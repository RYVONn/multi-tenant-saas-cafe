import { Link, useRouterState } from "@tanstack/react-router";
import { Languages, LogOut, Menu, Search, Bell } from "lucide-react";
import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useAuth, roleLabel } from "@/lib/auth";
import { business } from "@/lib/mock-data";
import { navByRole } from "@/lib/nav";
import { cn } from "@/lib/utils";
import { Avatar } from "./ui-kit";

export function AppShell({ children }: { children: ReactNode }) {
  const { user, logout, dir, toggleDir } = useAuth();
  const { t } = useTranslation();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const [mobileOpen, setMobileOpen] = useState(false);
  if (!user) return null;
  const isPlatform = user.role === "platform_admin";
  const items = navByRole[user.role];
  const rtl = dir === "rtl";

  // Edge + slide transform computed in JS (not ltr:/rtl: variants) to avoid specificity flicker.
  const sideStyle: React.CSSProperties = {
    [rtl ? "right" : "left"]: 0,
    [rtl ? "borderLeftWidth" : "borderRightWidth"]: 1,
    transform: mobileOpen ? "translateX(0)" : undefined,
    ["--hide" as string]: rtl ? "100%" : "-100%",
  };

  return (
    <div className="min-h-screen">
      {mobileOpen && <div className="fixed inset-0 z-30 bg-secondary/30 lg:hidden" onClick={() => setMobileOpen(false)} />}
      <aside style={sideStyle} className={cn("fixed inset-y-0 z-40 flex w-64 flex-col bg-card transition-transform duration-200 lg:translate-x-0", !mobileOpen && "max-lg:[transform:translateX(var(--hide))]")}>
        <div className="flex h-16 shrink-0 items-center gap-3 border-b px-4">
          <span className={cn("grid h-9 w-9 place-items-center rounded-lg text-sm font-bold", isPlatform ? "bg-platform text-primary-foreground" : "bg-primary text-primary-foreground")}>
            {isPlatform ? "PA" : business.initials}
          </span>
          <div className="min-w-0">
            <div className="truncate font-heading text-sm font-bold text-secondary">{isPlatform ? "Platform Console" : business.name}</div>
            <div className="truncate text-xs text-muted-foreground">{isPlatform ? "All businesses" : `/${business.slug}`}</div>
          </div>
        </div>
        <nav className="flex-1 space-y-0.5 overflow-y-auto p-3">
          {items.map((it) => {
            const active = path === it.to;
            return (
              <Link key={it.to} to={it.to} onClick={() => setMobileOpen(false)} className={cn("relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors", active ? (isPlatform ? "bg-platform text-primary-foreground" : "bg-primary text-primary-foreground") : "text-foreground/80 hover:bg-accent hover:text-accent-foreground")}>
                <it.icon className="h-4 w-4 shrink-0" />
                <span className="truncate">{t(`nav.${it.key}`)}</span>
                {!!it.badge && <span className="num ms-auto grid h-5 min-w-5 place-items-center rounded-full bg-destructive px-1.5 text-[10px] font-bold text-destructive-foreground">{it.badge}</span>}
              </Link>
            );
          })}
        </nav>
        <div className="flex items-center gap-3 border-t p-3">
          <Avatar name={user.name} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">{user.name}</div>
            <div className="truncate text-xs text-muted-foreground">{roleLabel[user.role]}</div>
          </div>
          <button onClick={logout} title={t("common.logout")} className="cursor-pointer rounded-lg p-2 text-muted-foreground transition hover:bg-destructive-soft hover:text-destructive">
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </aside>

      <div className={rtl ? "lg:pr-64" : "lg:pl-64"}>
        <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b bg-card/85 px-4 backdrop-blur md:px-8">
          <button className="rounded-lg p-2 hover:bg-muted lg:hidden" onClick={() => setMobileOpen(true)}><Menu className="h-5 w-5" /></button>
          <div className="relative hidden max-w-sm flex-1 md:block">
            <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input placeholder={t("common.search")} className="h-9 w-full rounded-lg border bg-muted/50 ps-9 pe-3 text-sm outline-none focus:border-ring focus:bg-card" />
          </div>
          <div className="ms-auto flex items-center gap-1">
            {isPlatform && <span className="me-2 rounded-full bg-platform-soft px-3 py-1 text-xs font-semibold text-platform">Platform scope</span>}
            <button onClick={toggleDir} className="flex cursor-pointer items-center gap-1.5 rounded-lg px-2.5 py-2 text-xs font-medium text-muted-foreground hover:bg-muted"><Languages className="h-4 w-4" />{rtl ? "RTL" : "LTR"}</button>
            <button className="relative rounded-lg p-2 text-muted-foreground hover:bg-muted"><Bell className="h-4 w-4" /><span className="absolute end-1.5 top-1.5 h-2 w-2 rounded-full bg-destructive" /></button>
          </div>
        </header>
        <main className="mx-auto max-w-[1400px] p-4 md:p-8">{children}</main>
      </div>
    </div>
  );
}
