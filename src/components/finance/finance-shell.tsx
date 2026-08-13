"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { type ReactNode } from "react";
import { AtlasAppBackground } from "@/components/atlas/app-background";
import { FinanceTabs } from "./finance-tabs";
import { FinanceWorkspaceProvider } from "./finance-workspace-context";
import { AtlasGlobalHeader } from "@/components/atlas/atlas-global-header";
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
        <AtlasGlobalHeader profile={profile} modules={modules} providerHealth={providerHealth} />

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
