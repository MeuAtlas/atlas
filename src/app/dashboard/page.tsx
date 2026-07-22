import { redirect } from "next/navigation";

import { LogoutButton } from "@/components/auth/logout-button";
import { PrivateShell } from "@/components/atlas/private-shell";
import { getAuthContext, isCurrentUserSuperAdmin } from "@/lib/auth/session";
import type { Family, FamilyMember } from "@/types/atlas";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const { supabase, user, profile } = await getAuthContext();
  if (!user || !profile) redirect("/login");
  if (!profile.onboarding_completed) redirect("/onboarding");

  const [{ data: memberData }, isSuperAdmin] = await Promise.all([
    supabase
      .from("family_members")
      .select("family_id")
      .eq("user_id", user.id)
      .eq("status", "active")
      .maybeSingle(),
    isCurrentUserSuperAdmin(supabase),
  ]);
  const membership = memberData as Pick<FamilyMember, "family_id"> | null;

  let familyName: string | null = null;
  if (membership) {
    const { data: familyData } = await supabase
      .from("families")
      .select("name")
      .eq("id", membership.family_id)
      .is("archived_at", null)
      .maybeSingle();
    familyName = (familyData as Pick<Family, "name"> | null)?.name ?? null;
  }

  const preferredName =
    profile.preferred_name || profile.full_name?.split(/\s+/)[0] || "você";

  return (
    <PrivateShell isSuperAdmin={isSuperAdmin}>
      <section className="atlas-card-enter relative z-[1] mx-auto my-12 w-full max-w-2xl self-center rounded-[var(--atlas-radius)] border border-[var(--atlas-border)] bg-[var(--atlas-surface)] p-7 shadow-[var(--atlas-shadow)] backdrop-blur-xl sm:p-11">
        <p className="mb-3 text-xs font-semibold uppercase tracking-[.18em] text-[var(--atlas-blue)]">Espaço pessoal</p>
        <h1 className="text-3xl font-semibold tracking-[-.04em] text-[var(--atlas-text)] sm:text-4xl">Visão Atlas</h1>
        <p className="mt-3 text-lg text-[var(--atlas-text)]">Bem-vindo, {preferredName}.</p>
        <p className="mt-2 text-[var(--atlas-muted)]">Este é o seu espaço pessoal no Atlas.</p>

        <div className="mt-8 grid gap-4 rounded-2xl border border-[var(--atlas-border)] bg-[var(--atlas-surface-solid)] p-5 sm:grid-cols-[1fr_auto] sm:items-center">
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-wider text-[var(--atlas-muted)]">Conta autenticada</p>
            <p className="mt-1 truncate text-sm font-medium text-[var(--atlas-text)]">{user.email}</p>
            <p className="mt-3 text-xs font-medium uppercase tracking-wider text-[var(--atlas-muted)]">Vínculo familiar</p>
            <p className="mt-1 text-sm text-[var(--atlas-text)]">{familyName ?? "Nenhuma família configurada"}</p>
          </div>
          <LogoutButton />
        </div>
        <p className="mt-5 text-xs leading-5 text-[var(--atlas-muted)]">Um vínculo familiar não concede acesso aos dados pessoais de outros membros.</p>
      </section>
    </PrivateShell>
  );
}
