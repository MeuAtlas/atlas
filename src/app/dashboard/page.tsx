import { redirect } from "next/navigation";

import { AtlasMark } from "@/components/atlas/atlas-mark";
import { OrbitalBackground } from "@/components/atlas/orbital-background";
import { ThemeToggle } from "@/components/atlas/theme-toggle";
import { LogoutButton } from "@/components/auth/logout-button";
import { createClient } from "@/lib/supabase/server";

export default async function DashboardPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <main className="relative grid min-h-svh overflow-hidden bg-[var(--atlas-bg)] p-5 sm:p-8">
      <OrbitalBackground />
      <header className="relative z-10 flex items-center justify-between">
        <AtlasMark className="size-10 text-[var(--atlas-blue)]" />
        <ThemeToggle />
      </header>
      <section className="atlas-card-enter relative z-[1] mx-auto my-12 w-full max-w-2xl self-center rounded-[var(--atlas-radius)] border border-[var(--atlas-border)] bg-[var(--atlas-surface)] p-7 shadow-[var(--atlas-shadow)] backdrop-blur-xl sm:p-11">
        <div className="mb-8 flex items-start justify-between gap-5">
          <div>
            <p className="mb-3 text-xs font-semibold uppercase tracking-[.18em] text-[var(--atlas-blue)]">Área privada</p>
            <h1 className="text-3xl font-semibold tracking-[-.04em] text-[var(--atlas-text)] sm:text-4xl">Visão Atlas</h1>
            <p className="mt-3 text-[var(--atlas-muted)]">Login realizado com sucesso.</p>
          </div>
          <div className="grid size-12 shrink-0 place-items-center rounded-full bg-[var(--atlas-blue-soft)] text-[var(--atlas-blue)]">
            <AtlasMark className="size-7" decorative />
          </div>
        </div>
        <div className="flex flex-col gap-4 rounded-2xl border border-[var(--atlas-border)] bg-[var(--atlas-surface-solid)] p-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-wider text-[var(--atlas-muted)]">Sessão ativa</p>
            <p className="mt-1 truncate text-sm font-medium text-[var(--atlas-text)]">{user.email}</p>
          </div>
          <LogoutButton />
        </div>
      </section>
      <div />
    </main>
  );
}
