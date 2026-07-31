"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { type ReactNode } from "react";
import { AtlasAppBackground } from "@/components/atlas/app-background";
import { AtlasLogo } from "@/components/atlas/atlas-logo";
import { ModuleSwitcher } from "@/components/atlas/module-switcher";
import { ThemeToggle } from "@/components/atlas/theme-toggle";
import { LogoutButton } from "@/components/auth/logout-button";
import { FinanceTabs } from "./finance-tabs";
import { FinanceWorkspaceProvider } from "./finance-workspace-context";
import type { AtlasModule, Profile, Workspace } from "@/types/atlas";

function BellIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 9a6 6 0 0 1 12 0c0 7 3 7 3 8H3c0-1 3-1 3-8Z" />
      <path d="M10 21h4" />
    </svg>
  );
}

export function FinanceShell({
  children,
  profile,
  workspaces,
  modules,
}: {
  children: ReactNode;
  profile: Profile;
  workspaces: Workspace[];
  modules: AtlasModule[];
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const name = profile.preferred_name || profile.full_name || "Perfil";
  const isOverview = pathname === "/financeiro";
  const withFinanceParams = (href: string) => {
    const query = searchParams.toString();
    return query ? `${href}?${query}` : href;
  };

  return (
    <main className="finance-app">
      <AtlasAppBackground />
      <div className="finance-scroll">
        <header className="finance-topbar">
          <Link href="/dashboard" className="finance-wordmark" aria-label="Atlas">
            <AtlasLogo size={42} priority />
          </Link>
          <ModuleSwitcher modules={modules} currentSlug="financeiro" />
          <div className="finance-profile">
            <button
              type="button"
              className="finance-notifications"
              aria-label="Notificações"
            >
              <BellIcon />
            </button>
            <ThemeToggle />
            <span>{name}</span>
            <LogoutButton />
          </div>
        </header>

        <div className="finance-navigation">
          <FinanceTabs
            activeRoute={pathname}
            query={searchParams.toString()}
          />
        </div>
        <FinanceWorkspaceProvider workspaces={workspaces}>
          <div className="finance-content">{children}</div>
        </FinanceWorkspaceProvider>
      </div>

      <nav
        className={`finance-bottom${isOverview ? " finance-bottom-overview" : ""}`}
        aria-label="Navegação global do Atlas"
      >
        <Link href="/dashboard">
          <i aria-hidden="true">⌂</i>
          <span>Início</span>
        </Link>
        <Link
          href={withFinanceParams("/financeiro")}
          className="active"
          aria-current="page"
        >
          <i aria-hidden="true">▥</i>
          <span>Financeiro</span>
        </Link>
        <Link href="/dashboard?modulo=agenda">
          <i aria-hidden="true">□</i>
          <span>Agenda</span>
        </Link>
        <Link href="/settings/family">
          <i aria-hidden="true">○</i>
          <span>Perfil</span>
        </Link>
      </nav>
    </main>
  );
}
