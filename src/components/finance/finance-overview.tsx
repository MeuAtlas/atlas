import Link from "next/link";
import { CurrentInvoiceCard } from "./current-invoice-card";
import type { BankMovementDetailsType } from "./bank-account-movement-cards";
import { CashFlowOverviewChart } from "./overview-charts";
import { Money, ValueVisibility } from "./value-visibility";
import { EmptyState } from "./empty-state";
import { FinanceAccountFilters } from "./finance-account-filters";
import { CurrentAccountBalanceCard } from "./current-account-balance-card";
import { AccountMovementAnalysis } from "./account-movement-analysis";
import type { CurrentCardInvoice } from "@/modules/finance/card-invoices";
import type { FinanceDashboard } from "@/modules/finance/dashboard";
import type { BankAccountMonthlyMovement } from "@/modules/finance/account-movement";
import type { FinancialAccount } from "@/modules/finance/types";

const daysBetween = (date: string, today: Date) =>
  Math.ceil(
    (new Date(`${date}T12:00:00Z`).valueOf() -
      Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate(), 12)) /
      86_400_000,
  );

function relativeDate(date: string, today: Date) {
  const days = daysBetween(date, today);
  if (days === 0) return "Hoje";
  if (days === 1) return "Amanhã";
  return days > 1 ? `Em ${days} dias` : `${Math.abs(days)} dias atrás`;
}

function greeting(timeZone: string, today: Date) {
  const hour = Number(
    new Intl.DateTimeFormat("pt-BR", {
      hour: "2-digit",
      hour12: false,
      timeZone,
    }).format(today),
  );
  if (hour < 12) return "Bom dia";
  if (hour < 18) return "Boa tarde";
  return "Boa noite";
}

export function FinanceOverview({
  dashboard,
  accounts,
  accountMovement,
  invoices,
  name,
  timeZone,
  workspace,
  warnings,
  initialDetails,
  today = new Date(),
}: {
  dashboard: FinanceDashboard;
  accounts: FinancialAccount[];
  accountMovement: BankAccountMonthlyMovement | null;
  invoices: CurrentCardInvoice[];
  name: string;
  timeZone: string;
  workspace: string;
  warnings: { cards: boolean; cardPurchases: boolean; connections: boolean };
  initialDetails?: BankMovementDetailsType;
  today?: Date;
}) {
  const monthLabel = new Intl.DateTimeFormat("pt-BR", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(
    new Date(
      Date.UTC(
        dashboard.selectedPeriod.year,
        dashboard.selectedPeriod.month - 1,
        1,
        12,
      ),
    ),
  );
  return (
    <ValueVisibility controls={false}>
      <div className="finance-overview">
        <section className="overview-hero" aria-labelledby="finance-page-title">
          <header>
            <div className="overview-hero-greeting">
              <p className="eyebrow">VISÃO GERAL</p>
              <h2 id="smart-title">
                {greeting(timeZone, today)}, {name}!
              </h2>
            </div>
            <div className="overview-hero-title">
              <h1 id="finance-page-title">Financeiro</h1>
              <p>Visão clara da sua vida financeira.</p>
            </div>
          </header>
        </section>

        {accountMovement ? (
          <>
            <CurrentAccountBalanceCard
              movement={accountMovement}
              timeZone={timeZone}
              filters={
                <FinanceAccountFilters
                  accounts={accounts}
                  accountId={accountMovement.accountId}
                  month={dashboard.selectedPeriod.key}
                  workspace={workspace}
                />
              }
            />
            <AccountMovementAnalysis
              movement={accountMovement}
              monthLabel={monthLabel}
              initialDetails={initialDetails}
            />
          </>
        ) : (
          <section className="overview-balance">
            <EmptyState
              title="Nenhuma conta bancária cadastrada"
              description="Adicione uma conta transacional para acompanhar entradas e saídas mensais."
              href="/financeiro/contas#nova"
              label="Adicionar conta"
            />
          </section>
        )}

        <div className="overview-grid overview-grid-primary">
          <section className="finance-panel overview-invoices">
            <header>
              <h2>Faturas vigentes</h2>
              <Link href="/financeiro/cartoes?view=current">Ver todas</Link>
            </header>
            {invoices.length ? (
              <div className="dashboard-invoice-grid">
                {invoices.map((invoice) => (
                  <CurrentInvoiceCard
                    key={invoice.card.id}
                    invoice={invoice}
                    compact
                    forcePartial={warnings.cards || warnings.cardPurchases}
                  />
                ))}
              </div>
            ) : (
              <div className="current-invoices-empty">
                <h3>Nenhuma fatura aberta</h3>
                <p>Os cartões ativos aparecerão aqui quando houver uma fatura vigente.</p>
                <Link href="/financeiro/cartoes?view=manage">Ver cartões</Link>
              </div>
            )}
          </section>

          <section
            className="finance-panel overview-commitments"
            id="compromissos"
          >
            <header>
              <h2>Próximos compromissos</h2>
              <Link href="/financeiro/movimentacoes">Ver todos</Link>
            </header>
            {dashboard.commitments.length ? (
              <div className="commitment-list">
                {dashboard.commitments.map((item) => {
                  const parsed = new Date(`${item.date}T12:00:00Z`);
                  return (
                    <Link href={item.href} key={item.id}>
                      <time dateTime={item.date}>
                        <b>{String(parsed.getUTCDate()).padStart(2, "0")}</b>
                        <small>
                          {new Intl.DateTimeFormat("pt-BR", {
                            month: "short",
                            timeZone: "UTC",
                          })
                            .format(parsed)
                            .replace(".", "")}
                        </small>
                      </time>
                      <span>
                        <b>{item.description}</b>
                        <small>{item.category}</small>
                      </span>
                      <span className="commitment-value">
                        <b><Money value={item.value} /></b>
                        <small>{relativeDate(item.date, today)}</small>
                      </span>
                    </Link>
                  );
                })}
              </div>
            ) : (
              <div className="overview-empty-compact">
                <b>Tudo em dia</b>
                <p>Nenhum compromisso financeiro próximo.</p>
              </div>
            )}
          </section>
        </div>

        <div className="overview-grid overview-grid-analytics">
          <section className="finance-panel overview-cash-flow">
            <header>
              <div>
                <p className="eyebrow">Últimos 6 meses</p>
                <h2>Fluxo financeiro</h2>
              </div>
              <Link href="/financeiro/relatorios">Detalhes</Link>
            </header>
            <CashFlowOverviewChart data={dashboard.cashFlow} />
          </section>

          <section className="finance-panel overview-expenses">
            <header>
              <div>
                <p className="eyebrow">Este mês</p>
                <h2>Distribuição das despesas</h2>
              </div>
              <Link href="/financeiro/relatorios">Ver todas</Link>
            </header>
            {dashboard.expenseCategories.length ? (
              <div className="expense-bars">
                {dashboard.expenseCategories.map((category) => (
                  <div key={category.name}>
                    <span>
                      <b>{category.name}</b>
                      <small><Money value={category.value} /></small>
                    </span>
                    <div aria-hidden="true">
                      <i style={{ width: `${category.percentage}%` }} />
                    </div>
                    <strong>{category.percentage.toFixed(1)}%</strong>
                  </div>
                ))}
              </div>
            ) : (
              <div className="overview-empty-compact">
                <b>Sem despesas no período</b>
                <p>A distribuição aparecerá quando houver movimentações categorizadas.</p>
              </div>
            )}
          </section>
        </div>

        <div className="overview-grid overview-grid-footer">
          <section className="finance-panel overview-goals">
            <header>
              <h2>Objetivos financeiros</h2>
              <Link href="/financeiro/planejamento">Ver todos</Link>
            </header>
            <div className="overview-empty-compact">
              <b>Nenhum objetivo configurado</b>
              <p>Crie metas financeiras no Planejamento para acompanhá-las aqui.</p>
              <Link href="/financeiro/planejamento">Criar objetivo</Link>
            </div>
          </section>

          <section className="finance-panel overview-attention">
            <header>
              <h2>Atenção necessária</h2>
              {dashboard.attention.length ? (
                <Link href="/financeiro/movimentacoes?review=pending">
                  Ver todas
                </Link>
              ) : null}
            </header>
            {warnings.connections ? (
              <p className="overview-section-warning">
                O diagnóstico de sincronização está temporariamente indisponível.
              </p>
            ) : null}
            {dashboard.attention.length ? (
              <div className="attention-list">
                {dashboard.attention.map((item) => (
                  <Link href={item.href} key={item.id}>
                    <i aria-hidden="true">!</i>
                    <span>{item.label}</span>
                    <b className={item.priority.toLowerCase()}>{item.priority}</b>
                  </Link>
                ))}
              </div>
            ) : (
              <div className="overview-empty-compact success">
                <b>Tudo em ordem</b>
                <p>Nenhuma pendência financeira importante.</p>
              </div>
            )}
          </section>
        </div>
      </div>
    </ValueVisibility>
  );
}
