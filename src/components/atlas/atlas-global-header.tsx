"use client";

import { AtlasLogo } from "@/components/atlas/atlas-logo";
import { ModuleSwitcher } from "@/components/atlas/module-switcher";
import { ThemeToggle } from "@/components/atlas/theme-toggle";
import { LogoutButton } from "@/components/auth/logout-button";
import { NavigationLink } from "@/components/navigation/navigation-feedback";
import { FinanceNotifications } from "@/components/finance/finance-notifications";
import type { ProviderHealth } from "@/components/finance/provider-health-alert";
import type { AtlasModule, Profile } from "@/types/atlas";

export function AtlasGlobalHeader({
  profile,
  modules,
  providerHealth,
}: {
  profile: Profile;
  modules: AtlasModule[];
  providerHealth: ProviderHealth[];
}) {
  const name = profile.preferred_name || profile.full_name || "Perfil";
  return (
    <header className="finance-topbar">
      <NavigationLink href="/dashboard" prefetch={false} className="finance-wordmark" aria-label="Atlas">
        <AtlasLogo size={42} priority />
      </NavigationLink>
      <ModuleSwitcher modules={modules} />
      <div className="finance-profile">
        <FinanceNotifications connections={providerHealth} />
        <ThemeToggle />
        <span>{name}</span>
        <LogoutButton />
      </div>
    </header>
  );
}
