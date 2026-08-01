import Link from "next/link";
import type { ReactNode } from "react";

import { AtlasAppBackground } from "@/components/atlas/app-background";
import { AtlasLogo } from "@/components/atlas/atlas-logo";
import { ThemeToggle } from "@/components/atlas/theme-toggle";

export function PrivateShell({
  children,
  isSuperAdmin = false,
}: {
  children: ReactNode;
  isSuperAdmin?: boolean;
}) {
  return (
    <main className="atlas-private-shell">
      <AtlasAppBackground />
      <div className="atlas-private-scroll">
        <header className="relative z-10 flex items-center justify-between gap-4">
          <Link href="/dashboard" aria-label="Atlas — início">
            <AtlasLogo size={42} priority />
          </Link>
          <div className="flex items-center gap-3">
            {isSuperAdmin ? (
              <Link
                href="/admin"
                className="atlas-button-label rounded-xl border border-[var(--atlas-border)] bg-[var(--atlas-surface)] px-3 py-2 text-[var(--atlas-text)] shadow-sm backdrop-blur-md transition hover:border-[var(--atlas-blue)]/40 hover:bg-[var(--atlas-blue-soft)] sm:px-4"
              >
                Administração
              </Link>
            ) : null}
            <ThemeToggle />
          </div>
        </header>
        {children}
        <div />
      </div>
    </main>
  );
}
