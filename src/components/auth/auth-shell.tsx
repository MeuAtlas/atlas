import Link from "next/link";
import type { ReactNode } from "react";

import { AtlasLogo } from "@/components/atlas/atlas-logo";
import { OrbitalBackground } from "@/components/atlas/orbital-background";
import { ThemeToggle } from "@/components/atlas/theme-toggle";

export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <main className="atlas-auth-shell">
      <OrbitalBackground />
      <header className="atlas-auth-header">
        <Link href="/login" aria-label="Atlas — entrar">
          <AtlasLogo size={42} priority />
        </Link>
        <ThemeToggle />
      </header>
      <div className="atlas-auth-stage">{children}</div>
    </main>
  );
}
