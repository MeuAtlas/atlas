"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import type { AtlasModule } from "@/types/atlas";
import { NavigationLink } from "@/components/navigation/navigation-feedback";

function moduleHref(module: AtlasModule) {
  if (module.route) return module.route;
  if (module.slug === "financeiro") return "/financeiro";
  return `/dashboard?modulo=${encodeURIComponent(module.slug)}`;
}

export function ModuleSwitcher({
  modules,
}: {
  modules: AtlasModule[];
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const current = modules.find((module) => {
    const href = moduleHref(module);
    return pathname === href || pathname.startsWith(`${href}/`);
  }) ?? modules.find((module) => module.slug === "financeiro");

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        rootRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
      }
    };
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open]);

  return (
    <div className="module-switcher" ref={rootRef}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls="atlas-module-menu"
        onClick={() => setOpen((value) => !value)}
      >
        <span>{current?.name || "Financeiro"}</span>
        <i aria-hidden="true">⌄</i>
      </button>
      {open ? (
        <div id="atlas-module-menu" role="menu">
          {modules.map((module) => {
            const active = module.slug === current?.slug;
            return (
              <NavigationLink
                key={module.id}
                href={moduleHref(module)}
                prefetch={false}
                role="menuitem"
                aria-current={active ? "page" : undefined}
                className={active ? "active" : undefined}
                onClick={() => setOpen(false)}
              >
                <span>{module.name}</span>
                {active ? <small>Atual</small> : null}
              </NavigationLink>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
