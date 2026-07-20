import type { ReactNode } from "react";

import { AtlasMark } from "@/components/atlas/atlas-mark";
import { OrbitalBackground } from "@/components/atlas/orbital-background";
import { ThemeToggle } from "@/components/atlas/theme-toggle";

export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <main className="atlas-auth-shell">
      <OrbitalBackground />
      <header className="atlas-auth-header">
        <AtlasMark className="size-9 text-[var(--atlas-blue)] sm:size-10" />
        <ThemeToggle />
      </header>
      <div className="atlas-auth-stage">{children}</div>
    </main>
  );
}
