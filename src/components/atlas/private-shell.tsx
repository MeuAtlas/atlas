import type { ReactNode } from "react";
import Link from "next/link";

import { OrbitalBackground } from "@/components/atlas/orbital-background";
import { ThemeToggle } from "@/components/atlas/theme-toggle";

export function PrivateShell({
  children,
  isSuperAdmin = false,
}: {
  children: ReactNode;
  isSuperAdmin?: boolean;
}) {
  return (
    <main className="relative grid min-h-svh overflow-hidden bg-[var(--atlas-bg)] p-5 sm:p-8">
      <OrbitalBackground />
      <header className="relative z-10 flex items-center justify-end gap-4">
        <div className="flex items-center gap-3">
          {isSuperAdmin ? (
            <Link
              href="/admin"
              className="rounded-xl border border-[var(--atlas-border)] bg-[var(--atlas-surface)] px-3 py-2 text-xs font-semibold text-[var(--atlas-text)] shadow-sm backdrop-blur-md transition hover:border-[var(--atlas-blue)]/40 hover:bg-[var(--atlas-blue-soft)] sm:px-4 sm:text-sm"
            >
              Administração
            </Link>
          ) : null}
          <ThemeToggle />
        </div>
      </header>
      {children}
      <div />
    </main>
  );
}
