"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { type ReactNode } from "react";
import { AtlasAppBackground } from "@/components/atlas/app-background";
import { AtlasLogo } from "@/components/atlas/atlas-logo";
import { ModuleSwitcher } from "@/components/atlas/module-switcher";
import { ThemeToggle } from "@/components/atlas/theme-toggle";
import { LogoutButton } from "@/components/auth/logout-button";
import { FinanceTabs } from "./finance-tabs";
import { FinanceNotifications } from "./finance-notifications";
import { FinanceWorkspaceProvider } from "./finance-workspace-context";
import { NavigationLink } from "@/components/navigation/navigation-feedback";
import type { ProviderHealth } from "./provider-health-alert";
import type { AtlasModule, Profile, Workspace } from "@/types/atlas";

export function FinanceShell({
  children,
  profile,
  workspaces,
  modules,
  providerHealth,
}: {
  children: ReactNode;
  profile: Profile;
  workspaces: Workspace[];
  modules: AtlasModule[];
  providerHealth: ProviderHealth[];
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const name = profile.preferred_name || profile.full_name || "Perfil";
  const financeContext = new URLSearchParams();
  for (const name of ["workspace", "month", "account"]) {
    const value = searchParams.get(name);
    const validWorkspace = name !== "workspace" || workspaces.some((workspace) => workspace.id === value);
    if (value && validWorkspace) financeContext.set(name, value);
  }
  const financeQuery = financeContext.toString();

  return (
    <main className="finance-app">
      <AtlasAppBackground />
      <div className="finance-scroll">
        <header className="finance-topbar">
          <NavigationLink href="/dashboard" prefetch={false} className="finance-wordmark" aria-label="Atlas">
            <AtlasLogo size={42} priority />
          </NavigationLink>
          <ModuleSwitcher modules={modules} currentSlug="financeiro" />
          <div className="finance-profile">
            <FinanceNotifications connections={providerHealth} />
            <ThemeToggle />
            <span>{name}</span>
            <LogoutButton />
          </div>
        </header>

        <div className="finance-navigation">
          <FinanceTabs
            activeRoute={pathname}
            query={financeQuery}
          />
        </div>
        <FinanceWorkspaceProvider workspaces={workspaces}>
          <div className="finance-content">{children}</div>
        </FinanceWorkspaceProvider>
      </div>

    </main>
  );
}
