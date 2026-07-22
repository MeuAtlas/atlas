import Link from "next/link";
import type { ReactNode } from "react";

import { AtlasAppBackground } from "@/components/atlas/app-background";
import { ThemeToggle } from "@/components/atlas/theme-toggle";
import { LogoutButton } from "@/components/auth/logout-button";
import type { Profile, Workspace } from "@/types/atlas";

const tabs = [
  ["/financeiro", "Visão geral"],
  ["/financeiro/movimentacoes", "Movimentações"],
  ["/financeiro/contas", "Contas"],
  ["/financeiro/cartoes", "Cartões"],
  ["/financeiro/planejamento", "Planejamento"],
  ["/financeiro/relatorios", "Relatórios"],
  ["/financeiro/integracoes", "Integrações"],
] as const;

export function FinanceShell({ children, profile, workspaces }: { children: ReactNode; profile: Profile; workspaces: Workspace[] }) {
  const name = profile.preferred_name || profile.full_name || "Perfil";

  return (
    <main className="finance-app">
      <AtlasAppBackground />
      <div className="finance-scroll">
        <header className="finance-topbar">
          <Link href="/dashboard" className="finance-wordmark">Atlas</Link>
          <nav className="finance-main-nav" aria-label="Navegação principal"><Link href="/dashboard">Início</Link><Link href="/financeiro" className="active">Financeiro</Link></nav>
          <label className="finance-workspace"><span>Espaço</span><select aria-label="Espaço atual" defaultValue={workspaces[0]?.id}>{workspaces.map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}</select></label>
          <label className="finance-search"><span className="sr-only">Buscar</span><input placeholder="Buscar no Atlas" /></label>
          <div className="finance-profile"><span>{name}</span><ThemeToggle /><LogoutButton /></div>
        </header>
        <div className="finance-module-head"><div><p>Meu Atlas</p><h1>Financeiro</h1></div><Link href="/financeiro/movimentacoes#nova" className="finance-button finance-add">+ Adicionar</Link></div>
        <nav className="finance-tabs" aria-label="Seções do financeiro">{tabs.map(([href, label]) => <Link href={href} key={href}>{label}</Link>)}</nav>
        <div className="finance-content">{children}</div>
      </div>
      <nav className="finance-bottom" aria-label="Navegação móvel"><Link href="/dashboard">Início</Link><Link href="/financeiro">Resumo</Link><Link href="/financeiro/movimentacoes#nova" className="finance-bottom-add">+</Link><Link href="/financeiro/movimentacoes">Movimentos</Link><Link href="/financeiro/contas">Contas</Link></nav>
    </main>
  );
}
