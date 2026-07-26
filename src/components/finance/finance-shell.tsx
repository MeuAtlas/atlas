"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { AtlasAppBackground } from "@/components/atlas/app-background";
import { AtlasLogo } from "@/components/atlas/atlas-logo";
import { ModuleSwitcher } from "@/components/atlas/module-switcher";
import { ThemeToggle } from "@/components/atlas/theme-toggle";
import { LogoutButton } from "@/components/auth/logout-button";
import { FinanceTabs } from "./finance-tabs";
import { FinanceWorkspaceProvider } from "./finance-workspace-context";
import type { AtlasModule, Profile, Workspace } from "@/types/atlas";

const movementOptions = [
  ["income", "Receita", "Registrar uma entrada"],
  ["expense", "Despesa", "Registrar um gasto"],
  ["transfer", "Transferência", "Mover entre contas próprias"],
  ["payable", "Conta a pagar", "Criar um compromisso"],
  ["receivable", "Valor a receber", "Planejar uma entrada"],
  ["card", "Compra no cartão", "Lançar em uma fatura"],
  ["payroll", "Desconto em folha", "Registrar consignado ou benefício"],
] as const;

function BellIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 9a6 6 0 0 1 12 0c0 7 3 7 3 8H3c0-1 3-1 3-8Z" />
      <path d="M10 21h4" />
    </svg>
  );
}

function AddMovementSheet({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    document.body.classList.add("finance-sheet-open");
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.classList.remove("finance-sheet-open");
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="finance-sheet-backdrop" onMouseDown={onClose}>
      <section
        className="finance-movement-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="movement-sheet-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <p className="eyebrow">Financeiro</p>
            <h2 id="movement-sheet-title">Nova movimentação</h2>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Fechar nova movimentação"
          >
            ×
          </button>
        </header>
        <div>
          {movementOptions.map(([type, label, description]) => (
            <Link
              key={type}
              href={`/financeiro/movimentacoes?tipo=${type}#nova`}
              onClick={onClose}
            >
              <i aria-hidden="true">+</i>
              <span>
                <b>{label}</b>
                <small>{description}</small>
              </span>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}

export function FinanceShell({
  children,
  profile,
  workspaces,
  modules,
}: {
  children: ReactNode;
  profile: Profile;
  workspaces: Workspace[];
  modules: AtlasModule[];
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [sheetOpen, setSheetOpen] = useState(false);
  const name = profile.preferred_name || profile.full_name || "Perfil";
  const isOverview = pathname === "/financeiro";
  const withFinanceParams = (href: string) => {
    const query = searchParams.toString();
    return query ? `${href}?${query}` : href;
  };

  return (
    <main className="finance-app">
      <AtlasAppBackground />
      <div className="finance-scroll">
        <header className="finance-topbar">
          <Link href="/dashboard" className="finance-wordmark" aria-label="Atlas">
            <AtlasLogo size={42} priority />
          </Link>
          <ModuleSwitcher modules={modules} currentSlug="financeiro" />
          <div className="finance-profile">
            <button
              type="button"
              className="finance-notifications"
              aria-label="Notificações"
            >
              <BellIcon />
            </button>
            <ThemeToggle />
            <span>{name}</span>
            <LogoutButton />
          </div>
        </header>

        <div className="finance-navigation">
          <FinanceTabs
            activeRoute={pathname}
            query={searchParams.toString()}
          />
          {!isOverview ? (
            <button
              type="button"
              className="finance-button finance-add"
              onClick={() => setSheetOpen(true)}
            >
              <span aria-hidden="true">＋</span>
              Nova movimentação
            </button>
          ) : null}
        </div>
        <FinanceWorkspaceProvider workspaces={workspaces}>
          <div className="finance-content">{children}</div>
        </FinanceWorkspaceProvider>
      </div>

      <nav
        className={`finance-bottom${isOverview ? " finance-bottom-overview" : ""}`}
        aria-label="Navegação global do Atlas"
      >
        <Link href="/dashboard">
          <i aria-hidden="true">⌂</i>
          <span>Início</span>
        </Link>
        <Link
          href={withFinanceParams("/financeiro")}
          className="active"
          aria-current="page"
        >
          <i aria-hidden="true">▥</i>
          <span>Financeiro</span>
        </Link>
        {!isOverview ? (
          <button
            type="button"
            className="finance-bottom-add"
            onClick={() => setSheetOpen(true)}
            aria-label="Nova movimentação"
          >
            +
          </button>
        ) : null}
        <Link href="/dashboard?modulo=agenda">
          <i aria-hidden="true">□</i>
          <span>Agenda</span>
        </Link>
        <Link href="/settings/family">
          <i aria-hidden="true">○</i>
          <span>Perfil</span>
        </Link>
      </nav>

      {!isOverview ? (
        <AddMovementSheet open={sheetOpen} onClose={() => setSheetOpen(false)} />
      ) : null}
    </main>
  );
}
