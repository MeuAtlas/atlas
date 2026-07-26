import Link from "next/link";

export type CreditCardPageView =
  | "current"
  | "history"
  | "manage"
  | "archived";

const tabs: Array<[CreditCardPageView, string]> = [
  ["current", "Fatura atual"],
  ["history", "Faturas anteriores"],
  ["manage", "Gerenciar cartões"],
  ["archived", "Arquivados"],
];

export function CreditCardViewTabs({
  activeView,
  workspace,
}: {
  activeView: CreditCardPageView;
  workspace?: string;
}) {
  return (
    <nav className="credit-card-view-tabs" aria-label="Visualizações de cartões">
      {tabs.map(([view, label]) => {
        const params = new URLSearchParams({ view });
        if (workspace) params.set("workspace", workspace);
        return (
          <Link
            key={view}
            href={`/financeiro/cartoes?${params}`}
            className={activeView === view ? "active" : undefined}
            aria-current={activeView === view ? "page" : undefined}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
