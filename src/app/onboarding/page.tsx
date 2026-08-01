import { redirect } from "next/navigation";

import { OnboardingForm } from "@/components/auth/onboarding-form";
import { PrivateShell } from "@/components/atlas/private-shell";
import { getAuthContext } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  const { user, profile } = await getAuthContext();
  if (!user || !profile) redirect("/login");
  if (profile.onboarding_completed) redirect("/dashboard");

  return (
    <PrivateShell>
      <section className="atlas-card-enter relative z-[1] mx-auto my-8 w-full max-w-xl self-center rounded-[var(--atlas-radius)] border border-[var(--atlas-border)] bg-[var(--atlas-surface)] p-6 shadow-[var(--atlas-shadow)] backdrop-blur-xl sm:p-10">
        <p className="atlas-label text-[var(--atlas-blue)]">Primeiro acesso</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-[-.04em] text-[var(--atlas-text)]">Prepare seu Atlas pessoal</h1>
        <p className="mt-3 text-sm leading-6 text-[var(--atlas-muted)]">Estas informações pertencem somente ao seu perfil. Você poderá configurar uma família depois, sem compartilhar automaticamente seus dados.</p>
        <OnboardingForm profile={profile} />
      </section>
    </PrivateShell>
  );
}
