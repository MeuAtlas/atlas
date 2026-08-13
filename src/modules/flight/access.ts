import { redirect } from "next/navigation";
import { cache } from "react";
import { getAuthContext } from "@/lib/auth/session";
import { throwSupabaseError } from "@/lib/errors";
import { withQueryFallback } from "@/lib/supabase/query-fallback";
import type { ProviderHealth } from "@/components/finance/provider-health-alert";
import type { AtlasModule } from "@/types/atlas";

async function loadFlightAccess() {
  const context = await getAuthContext();
  if (!context.user || !context.profile) redirect("/login");
  if (!context.profile.onboarding_completed) redirect("/onboarding");
  if (context.profile.status === "suspended") redirect("/login?error=account_suspended");
  const scaleModule = await context.supabase.from("modules").select("id")
    .eq("slug", "escala").eq("is_globally_active", true).maybeSingle();
  if (scaleModule.error) throwSupabaseError(scaleModule.error, "verificar módulo Escala", "Não foi possível verificar seu acesso à Escala.");
  const grant = scaleModule.data ? await context.supabase.from("user_modules").select("enabled")
    .eq("user_id", context.user.id).eq("module_id", scaleModule.data.id).maybeSingle() : null;
  if (grant?.error) throwSupabaseError(grant.error, "verificar permissão da Escala", "Não foi possível verificar seu acesso à Escala.");
  if (!scaleModule.data || !grant?.data?.enabled) redirect("/dashboard?module=disabled");
  return context;
}

export const requireFlightAccess = cache(loadFlightAccess);

export async function getFlightShellData(
  access: Awaited<ReturnType<typeof requireFlightAccess>>,
) {
  const [modulesResult, grantsResult, health] = await Promise.all([
    access.supabase.from("modules").select("id,slug,name,description,icon,route,category,is_default,is_globally_active").eq("is_globally_active", true),
    access.supabase.from("user_modules").select("module_id").eq("user_id", access.user.id).eq("enabled", true),
    withQueryFallback("flight_provider_health", access.supabase.from("bank_connections")
      .select("id,connector_name,provider_status,data_completeness,sync_status,last_sync_at,last_complete_sync_at,stale_since,partial_data_count")
      .eq("owner_id", access.user.id).eq("provider", "pluggy").neq("status", "disabled"), []),
  ]);
  if (modulesResult.error || grantsResult.error) {
    throwSupabaseError(modulesResult.error ?? grantsResult.error!, "carregar módulos habilitados", "Não foi possível carregar os módulos disponíveis.");
  }
  const enabledIds = new Set((grantsResult.data ?? []).map((grant) => String(grant.module_id)));
  const modules = (modulesResult.data ?? []).filter((module) => enabledIds.has(String(module.id)))
    .sort((left, right) => {
      if (left.slug === "financeiro") return -1;
      if (right.slug === "financeiro") return 1;
      return String(left.name).localeCompare(String(right.name), "pt-BR");
    }) as AtlasModule[];
  const providerHealth = health.data.map((row) => ({
    id: String(row.id), connectorName: row.connector_name ? String(row.connector_name) : null,
    providerStatus: String(row.provider_status), dataCompleteness: String(row.data_completeness),
    syncStatus: String(row.sync_status), lastSyncAt: row.last_sync_at ? String(row.last_sync_at) : null,
    lastCompleteSyncAt: row.last_complete_sync_at ? String(row.last_complete_sync_at) : null,
    incidentStartedAt: row.stale_since ? String(row.stale_since) : null,
    partialDataCount: Number(row.partial_data_count ?? 0),
  }) satisfies ProviderHealth);
  return { modules, providerHealth };
}
