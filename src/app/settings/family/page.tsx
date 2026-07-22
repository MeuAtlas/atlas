import { redirect } from "next/navigation";

import { PrivateShell } from "@/components/atlas/private-shell";
import { getAuthContext } from "@/lib/auth/session";
import type { Family, FamilyMember } from "@/types/atlas";

export const dynamic = "force-dynamic";

export default async function FamilySettingsPage() {
  const { supabase, user, profile } = await getAuthContext();
  if (!user || !profile) redirect("/login");
  if (!profile.onboarding_completed) redirect("/onboarding");

  const { data: memberData } = await supabase
    .from("family_members")
    .select("family_id, role")
    .eq("user_id", user.id)
    .eq("status", "active")
    .maybeSingle();
  const membership = memberData as Pick<FamilyMember, "family_id" | "role"> | null;

  let family: Pick<Family, "name"> | null = null;
  if (membership) {
    const { data } = await supabase
      .from("families")
      .select("name")
      .eq("id", membership.family_id)
      .is("archived_at", null)
      .maybeSingle();
    family = data as Pick<Family, "name"> | null;
  }

  return (
    <PrivateShell>
      <section className="atlas-card-enter relative z-[1] mx-auto my-12 w-full max-w-2xl self-center rounded-[var(--atlas-radius)] border border-[var(--atlas-border)] bg-[var(--atlas-surface)] p-7 shadow-[var(--atlas-shadow)] backdrop-blur-xl sm:p-11">
        <p className="text-xs font-semibold uppercase tracking-[.18em] text-[var(--atlas-blue)]">Configurações</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-[-.04em] text-[var(--atlas-text)]">Família</h1>
        {family && membership ? (
          <div className="mt-7 rounded-2xl border border-[var(--atlas-border)] bg-[var(--atlas-surface-solid)] p-5">
            <p className="font-medium text-[var(--atlas-text)]">{family.name}</p>
            <p className="mt-2 text-sm text-[var(--atlas-muted)]">Seu papel: {membership.role}</p>
          </div>
        ) : (
          <div className="mt-7 rounded-2xl border border-[var(--atlas-border)] bg-[var(--atlas-surface-solid)] p-5">
            <p className="font-medium text-[var(--atlas-text)]">Você ainda não faz parte de uma família.</p>
            <p className="mt-2 text-sm leading-6 text-[var(--atlas-muted)]">Criar uma família ou entrar por convite será opcional. Esta tela está preparada para receber essas ações em uma próxima etapa.</p>
          </div>
        )}
        <p className="mt-5 text-sm leading-6 text-[var(--atlas-muted)]">Família representa somente um vínculo entre contas. Seus dados pessoais permanecem privados.</p>
      </section>
    </PrivateShell>
  );
}
