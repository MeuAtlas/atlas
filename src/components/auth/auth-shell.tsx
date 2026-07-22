import type { ReactNode } from "react";

import { OrbitalBackground } from "@/components/atlas/orbital-background";
import { ThemeToggle } from "@/components/atlas/theme-toggle";

export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <main className="atlas-auth-shell">
      <OrbitalBackground />
      <header className="atlas-auth-header">
        <ThemeToggle />
      </header>
      <div className="atlas-auth-stage">{children}</div>
    </main>
  );
}
