import { redirect } from "next/navigation";
import { throwSupabaseError } from "@/lib/errors";
import { getAuthContext } from "@/lib/auth/session";
import type { AtlasModule, Workspace } from "@/types/atlas";

export async function requireFinanceAccess() {
  const context = await getAuthContext();
  if (!context.user || !context.profile) redirect("/login");
  if (!context.profile.onboarding_completed) redirect("/onboarding");
  if (context.profile.status === "suspended") redirect("/login?error=account_suspended");

  const moduleResult = await context.supabase
    .from("modules")
    .select("id")
    .eq("slug", "financeiro")
    .eq("is_globally_active", true)
    .maybeSingle();

  if (moduleResult.error) {
    throwSupabaseError(moduleResult.error, "carregar módulo financeiro (modules)", "Não foi possível verificar o acesso ao Financeiro.");
  }
  if (!moduleResult.data) redirect("/dashboard?module=unavailable");

  const grantResult = await context.supabase
    .from("user_modules")
    .select("enabled")
    .eq("user_id", context.user.id)
    .eq("module_id", moduleResult.data.id)
    .maybeSingle();

  if (grantResult.error) {
    throwSupabaseError(grantResult.error, "carregar permissão financeira (user_modules)", "Não foi possível verificar sua permissão para o Financeiro.");
  }
  if (!grantResult.data?.enabled) redirect("/dashboard?module=disabled");
  return context;
}

export async function getWorkspaces() {
  const { supabase } = await requireFinanceAccess();
  const result = await supabase.from("workspaces").select("id,owner_id,name,slug,type").order("type");
  if (result.error) {
    throwSupabaseError(result.error, "carregar espaços pessoais (workspaces)", "Não foi possível carregar seus espaços.");
  }
  return (result.data ?? []) as Workspace[];
}

export async function getFinanceShellData(
  access: Awaited<ReturnType<typeof requireFinanceAccess>>,
) {
  const [workspacesResult, modulesResult, grantsResult] = await Promise.all([
    access.supabase
      .from("workspaces")
      .select("id,owner_id,name,slug,type")
      .order("type"),
    access.supabase
      .from("modules")
      .select(
        "id,slug,name,description,icon,route,category,is_default,is_globally_active",
      )
      .eq("is_globally_active", true),
    access.supabase
      .from("user_modules")
      .select("module_id,enabled")
      .eq("user_id", access.user.id)
      .eq("enabled", true),
  ]);

  if (workspacesResult.error) {
    throwSupabaseError(
      workspacesResult.error,
      "carregar espaços pessoais (workspaces)",
      "Não foi possível carregar seus espaços.",
    );
  }
  if (modulesResult.error || grantsResult.error) {
    throwSupabaseError(
      modulesResult.error ?? grantsResult.error!,
      "carregar módulos habilitados",
      "Não foi possível carregar os módulos disponíveis.",
    );
  }

  const enabledIds = new Set(
    (grantsResult.data ?? []).map((grant) => String(grant.module_id)),
  );
  const modules = (modulesResult.data ?? [])
    .filter((module) => enabledIds.has(String(module.id)))
    .sort((left, right) => {
      if (left.slug === "financeiro") return -1;
      if (right.slug === "financeiro") return 1;
      return String(left.name).localeCompare(String(right.name), "pt-BR");
    }) as AtlasModule[];

  return {
    workspaces: (workspacesResult.data ?? []) as Workspace[],
    modules,
  };
}
