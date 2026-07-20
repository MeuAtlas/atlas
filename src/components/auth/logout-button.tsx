"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { LogOutIcon } from "@/components/atlas/icons";
import { createClient } from "@/lib/supabase/client";

export function LogoutButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function logout() {
    if (loading) return;
    setLoading(true);
    const supabase = createClient();
    await supabase.auth.signOut();
    router.replace("/login");
    router.refresh();
  }

  return (
    <button type="button" onClick={logout} disabled={loading} className="flex h-11 items-center justify-center gap-2 rounded-xl border border-[var(--atlas-border)] bg-[var(--atlas-surface-solid)] px-4 text-sm font-medium text-[var(--atlas-text)] shadow-sm transition hover:-translate-y-px hover:border-[var(--atlas-blue)]/40 hover:bg-[var(--atlas-blue-soft)] disabled:cursor-wait disabled:opacity-60">
      <LogOutIcon className="size-[18px]" /> {loading ? "Saindo…" : "Sair"}
    </button>
  );
}
