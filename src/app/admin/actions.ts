"use server";

import { revalidatePath } from "next/cache";
import { throwSupabaseError } from "@/lib/errors";
import { getAuthContext, isCurrentUserSuperAdmin } from "@/lib/auth/session";

async function requireSuperAdmin() {
  const context = await getAuthContext();
  if (!context.user || !(await isCurrentUserSuperAdmin(context.supabase))) throw new Error("Acesso negado.");
  return { ...context, user: context.user };
}

export async function setUserModule(data: FormData) {
  const { supabase } = await requireSuperAdmin();
  const result = await supabase.rpc("admin_set_user_module", { target_user: String(data.get("user_id")), target_module: String(data.get("module_slug")), target_enabled: String(data.get("enabled")) === "true" });
  if (result.error) throwSupabaseError(result.error, "alterar módulo do usuário (admin_set_user_module)", "Não foi possível alterar o módulo.");
  revalidatePath("/admin/usuarios");
}

export async function setUserStatus(data: FormData) {
  const { supabase, user } = await requireSuperAdmin();
  const target = String(data.get("user_id"));
  if (target === user.id) throw new Error("O administrador não pode suspender a própria conta.");
  const status = String(data.get("status"));
  if (!["active", "suspended"].includes(status)) throw new Error("Status inválido.");
  const result = await supabase.from("profiles").update({ status }).eq("id", target);
  if (result.error) throwSupabaseError(result.error, "alterar status do usuário (profiles)", "Não foi possível alterar o acesso.");
  revalidatePath("/admin/usuarios");
}

export async function setWorkspaceModule(data: FormData) {
  const { supabase } = await requireSuperAdmin();
  const result = await supabase.rpc("admin_set_workspace_module", { target_workspace: String(data.get("workspace_id")), target_module: String(data.get("module_slug")), target_enabled: String(data.get("enabled")) === "true" });
  if (result.error) throwSupabaseError(result.error, "alterar módulo do workspace (admin_set_workspace_module)", "Não foi possível alterar o workspace.");
  revalidatePath("/admin/espacos");
}
