import Link from "next/link";

export type FinanceTabItem = {
  label: string;
  href: string;
};

const items: FinanceTabItem[] = [
  { href: "/financeiro", label: "Visão geral" },
  { href: "/financeiro/movimentacoes", label: "Movimentações" },
  { href: "/financeiro/contas", label: "Contas" },
  { href: "/financeiro/cartoes", label: "Cartões" },
  { href: "/financeiro/emprestimos", label: "Empréstimos" },
  { href: "/financeiro/receitas-despesas", label: "Receitas e Despesas" },
  { href: "/financeiro/planejamento", label: "Planejamento" },
  { href: "/financeiro/relatorios", label: "Relatórios" },
  { href: "/financeiro/integracoes", label: "Integrações" },
];

export function FinanceTabs({
  activeRoute,
  query,
}: {
  activeRoute: string;
  query: string;
}) {
  return (
    <nav className="finance-tabs" aria-label="Seções do financeiro">
      {items.map((item) => {
        const [path, hash] = item.href.split("#");
        const active =
          !hash &&
          (path === "/financeiro"
            ? activeRoute === path
            : activeRoute.startsWith(path));
        const href = `${path}${query ? `?${query}` : ""}${hash ? `#${hash}` : ""}`;
        if (active) {
          return (
            <span key={item.label} className="active" aria-current="page">
              {item.label}
            </span>
          );
        }
        return (
          <Link
            href={href}
            key={item.label}
            prefetch={false}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
