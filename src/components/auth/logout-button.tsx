"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { LogOutIcon } from "@/components/atlas/icons";
import { createClient } from "@/lib/supabase/client";

export function LogoutButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function logout() {
    if (loading) return;
    setLoading(true);
    setError(null);
    const supabase = createClient();
    const { error: signOutError } = await supabase.auth.signOut();

    if (signOutError) {
      setError("Não foi possível encerrar a sessão. Tente novamente.");
      setLoading(false);
      return;
    }

    router.replace("/login");
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <button type="button" onClick={logout} disabled={loading} className="flex h-11 items-center justify-center gap-2 rounded-xl border border-[var(--atlas-border)] bg-[var(--atlas-surface-solid)] px-4 text-sm font-medium text-[var(--atlas-text)] shadow-sm transition hover:-translate-y-px hover:border-[var(--atlas-blue)]/40 hover:bg-[var(--atlas-blue-soft)] disabled:cursor-wait disabled:opacity-60">
        <LogOutIcon className="size-[18px]" /> {loading ? "Saindo…" : "Sair"}
      </button>
      {error ? <p className="atlas-error-text">{error}</p> : null}
    </div>
  );
}
