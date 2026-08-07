import { redirect } from "next/navigation";
import { LogoutButton } from "@/components/auth/logout-button";
import { PrivateShell } from "@/components/atlas/private-shell";
import { PwaDeviceSettings } from "@/components/pwa/pwa-device-settings";
import { NavigationLink } from "@/components/navigation/navigation-feedback";
import { getAuthContext, isCurrentUserSuperAdmin } from "@/lib/auth/session";
import { throwSupabaseError } from "@/lib/errors";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const { supabase, user, profile } = await getAuthContext();
  if (!user || !profile) redirect("/login");
  if (!profile.onboarding_completed) redirect("/onboarding");
  if (profile.status === "suspended") redirect("/login?error=account_suspended");
  const [isAdmin, modulesResult, grantsResult] = await Promise.all([
    isCurrentUserSuperAdmin(supabase),
    supabase.from("modules").select("id,slug,name,description,route,category,is_globally_active").eq("is_globally_active", true).order("name"),
    supabase.from("user_modules").select("module_id").eq("user_id", user.id).eq("enabled", true),
  ]);
  if (modulesResult.error || grantsResult.error) {
    throwSupabaseError(
      modulesResult.error ?? grantsResult.error,
      "carregar módulos disponíveis no dashboard",
      "Não foi possível carregar os módulos disponíveis.",
    );
  }
  const enabled = new Set(grantsResult.data.map((grant) => grant.module_id));
  const availableModules = modulesResult.data.flatMap((module) => {
    const route = module.route?.trim();
    return enabled.has(module.id) && route ? [{ ...module, route }] : [];
  });
  const name = profile.preferred_name || profile.full_name?.split(/\s+/)[0] || "você";
  return (
    <PrivateShell isSuperAdmin={isAdmin}>
      <section className="relative z-10 mx-auto my-10 grid w-full max-w-6xl gap-5">
        <div className="rounded-[var(--atlas-radius)] border border-[var(--atlas-border)] bg-[var(--atlas-surface)] p-7 shadow-[var(--atlas-shadow)] backdrop-blur-xl sm:p-10">
          <div className="flex flex-wrap items-start justify-between gap-5">
            <div><p className="eyebrow">Meu Atlas</p><h1 className="mt-2 text-3xl font-semibold sm:text-4xl">Olá, {name}.</h1><p className="mt-2 text-[var(--atlas-muted)]">Escolha uma área para organizar sua vida.</p></div>
            <LogoutButton />
          </div>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {availableModules.map((module) => (
              <NavigationLink href={module.route} prefetch={false} key={module.id} className="finance-panel transition hover:-translate-y-1 hover:border-[var(--atlas-blue)]">
                <span className="text-2xl">✦</span>
                <h2 className="mt-4 font-semibold">{module.name}</h2>
                <p className="mt-2 min-h-10 text-sm text-[var(--atlas-muted)]">{module.description}</p>
                <span className="status success mt-5 inline-flex">Abrir módulo</span>
              </NavigationLink>
            ))}
            {availableModules.length === 0 ? (
              <p className="text-sm text-[var(--atlas-muted)]">Nenhum módulo está disponível no momento.</p>
            ) : null}
          </div>
        </div>
        <PwaDeviceSettings />
      </section>
    </PrivateShell>
  );
}
