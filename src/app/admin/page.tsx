import Link from "next/link";
import { redirect } from "next/navigation";

import { PrivateShell } from "@/components/atlas/private-shell";
import { getAuthContext, isCurrentUserSuperAdmin } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

const adminAreas = [
  {
    title: "Usuários",
    description: "Contas, estados de acesso e operações administrativas futuras.",
  },
  {
    title: "Integrações",
    description: "Conexões e serviços externos usados pelo Atlas.",
  },
  {
    title: "Auditoria",
    description: "Histórico futuro de ações administrativas justificadas.",
  },
  {
    title: "Configurações gerais",
    description: "Parâmetros globais e manutenção segura do sistema.",
  },
] as const;

export default async function AdminPage() {
  const { supabase, user, profile } = await getAuthContext();
  if (!user || !profile) redirect("/login");
  if (!profile.onboarding_completed) redirect("/onboarding");

  const isSuperAdmin = await isCurrentUserSuperAdmin(supabase);
  if (!isSuperAdmin) redirect("/dashboard");

  return (
    <PrivateShell isSuperAdmin>
      <section className="atlas-card-enter relative z-[1] mx-auto my-12 w-full max-w-4xl self-center rounded-[var(--atlas-radius)] border border-[var(--atlas-border)] bg-[var(--atlas-surface)] p-7 shadow-[var(--atlas-shadow)] backdrop-blur-xl sm:p-11">
        <p className="text-xs font-semibold uppercase tracking-[.18em] text-[var(--atlas-blue)]">
          Acesso global protegido
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-[-.04em] text-[var(--atlas-text)] sm:text-4xl">
          Administração do Atlas
        </h1>
        <p className="mt-3 text-sm leading-6 text-[var(--atlas-muted)]">
          Área restrita ao administrador geral do sistema.
        </p>

        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          {adminAreas.map((area) => (
            <article
              key={area.title}
              className="rounded-2xl border border-[var(--atlas-border)] bg-[var(--atlas-surface-solid)] p-5"
            >
              <h2 className="font-semibold text-[var(--atlas-text)]">{area.title}</h2>
              <p className="mt-2 text-sm leading-6 text-[var(--atlas-muted)]">
                {area.description}
              </p>
              <p className="mt-4 text-xs font-medium uppercase tracking-wider text-[var(--atlas-blue)]">
                Em preparação
              </p>
            </article>
          ))}
        </div>

        <div className="mt-7 flex flex-wrap items-center justify-between gap-4 border-t border-[var(--atlas-border)] pt-5">
          <p className="max-w-2xl text-xs leading-5 text-[var(--atlas-muted)]">
            O cargo administrativo não concede acesso aos espaços pessoais nem às informações de outros usuários.
          </p>
          <Link href="/dashboard" className="text-sm font-semibold text-[var(--atlas-blue)] hover:underline">
            Voltar à Visão Atlas
          </Link>
        </div>
      </section>
    </PrivateShell>
  );
}
