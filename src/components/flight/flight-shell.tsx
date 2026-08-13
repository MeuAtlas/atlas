"use client";

import type { ReactNode } from "react";
import { AtlasAppBackground } from "@/components/atlas/app-background";
import { AtlasGlobalHeader } from "@/components/atlas/atlas-global-header";
import type { ProviderHealth } from "@/components/finance/provider-health-alert";
import type { AtlasModule, Profile } from "@/types/atlas";

export function FlightShell({
  children,
  profile,
  modules,
  providerHealth,
}: {
  children: ReactNode;
  profile: Profile;
  modules: AtlasModule[];
  providerHealth: ProviderHealth[];
}) {
  return (
    <main className="finance-app">
      <AtlasAppBackground />
      <div className="finance-scroll">
        <AtlasGlobalHeader profile={profile} modules={modules} providerHealth={providerHealth} />
        <div className="finance-content">{children}</div>
      </div>
    </main>
  );
}
