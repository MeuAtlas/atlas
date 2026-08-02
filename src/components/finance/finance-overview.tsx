import Link from "next/link";
import { AccountMovementChart } from "./overview-charts";
import { FinanceAccountFilters } from "./finance-account-filters";
import { NextMonthExpenseDetails } from "./next-month-expense-details";
import { Money, ValueVisibility } from "./value-visibility";
import type {
  CurrentMonthFinanceSummary,
  FinanceAttentionItem,
  FinanceOverviewCommitment,
  FinanceOverviewDashboard,
  FinanceOverviewInvoice,
} from "@/modules/finance/finance-overview-dashboard";
import type { FinancialAccount } from "@/modules/finance/types";

function greeting(timeZone: string, today: Date) {
  const hour = Number(new Intl.DateTimeFormat("pt-BR", {
    hour: "2-digit", hour12: false, timeZone,
  }).format(today));
  if (hour < 12) return "Bom dia";
  if (hour < 18) return "Boa tarde";
  return "Boa noite";
}

const dateLabel = (date: string | null, timeZone = "America/Sao_Paulo") => date
  ? new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", timeZone })
    .format(new Date(`${date.slice(0, 10)}T12:00:00Z`))
  : "—";

const monthLabel = (month: string) => new Intl.DateTimeFormat("pt-BR", {
  month: "long", year: "numeric", timeZone: "America/Sao_Paulo",
}).format(new Date(`${month.slice(0, 7)}-01T12:00:00Z`));

const periodTitle = (month: string) => {
  const label = monthLabel(month);
  return `${label.charAt(0).toUpperCase()}${label.slice(1)}`;
};

const currency = (value: number) => new Intl.NumberFormat("pt-BR", {
  style: "currency", currency: "BRL",
}).format(Math.abs(value));

function FinanceDataFreshnessBadge({ partial, updatedAt, timeZone, showComplete = false }: {
  partial: boolean;
  updatedAt?: string | null;
  timeZone?: string;
  showComplete?: boolean;
}) {
  if (!partial && !showComplete) return null;
  const date = updatedAt ? dateLabel(updatedAt, timeZone) : null;
  return (
    <span className={`fov-freshness fov-data-status ${partial ? "partial" : "complete"}`} role="status">
      <i aria-hidden="true" />
      {partial ? "Dados parciais" : "Dados atualizados"}{date ? ` até ${date}` : ""}
    </span>
  );
}

function CurrentMonthSummaryCard({
  kind, title, value, explanation,
}: {
  kind: "balance" | "inflow" | "outflow" | "result";
  title: string;
  value: number;
  explanation?: string;
}) {
  return (
    <article className={`fov-position-card ${kind}`} data-testid={`current-${kind}`}>
      <div>
        <span className="fov-position-title">
          <i aria-hidden="true" />
          {title}
          {explanation ? <span className="fov-info-note" title={explanation} aria-label={explanation}>i</span> : null}
        </span>
        <strong className={kind === "outflow" || value < 0 ? "negative" : kind === "inflow" || value > 0 && kind === "result" ? "positive" : undefined}>
          <Money value={value} />
        </strong>
      </div>
      {kind === "result" ? <span className={`fov-result-direction ${value < 0 ? "negative" : "positive"}`} aria-hidden="true" /> : null}
    </article>
  );
}

function CurrentMonthSummaryGrid({ summary }: {
  summary: CurrentMonthFinanceSummary;
}) {
  const balanceExplanation = "Saldo bancário apurado no início do mês, antes das entradas e saídas deste período.";
  return (
    <section className="fov-position-grid" aria-label="Resumo realizado do mês selecionado">
      <CurrentMonthSummaryCard
        kind="balance" title="Saldo inicial" value={summary.openingBalance}
        explanation={balanceExplanation}
      />
      <CurrentMonthSummaryCard kind="inflow" title="Entradas" value={summary.currentMonthInflows} />
      <CurrentMonthSummaryCard kind="outflow" title="Saídas" value={summary.currentMonthOutflows} />
      <CurrentMonthSummaryCard kind="result" title="Resultado do mês" value={summary.currentMonthResult} />
      <CurrentMonthSummaryCard
        kind="balance" title="Saldo final" value={summary.closingBalance}
        explanation="O saldo final reconcilia o caixa do período: saldo inicial mais entradas, menos saídas."
      />
    </section>
  );
}

function HighlightMovement({ direction, item, timeZone }: {
  direction: "inflow" | "outflow";
  item: FinanceOverviewDashboard["selectedPeriod"]["largestMovements"]["largestInflow"];
  timeZone: string;
}) {
  return (
    <article className={`fov-highlight-movement ${direction}`}>
      <i aria-hidden="true">{direction === "inflow" ? "↗" : "↘"}</i>
      <div>
        <span>{direction === "inflow" ? "Maior entrada" : "Maior saída"}</span>
        {item ? <><strong><Money value={item.amount} /></strong><small>{dateLabel(item.date, timeZone)} <b title={item.description}>• {item.description}</b></small></>
          : <small>Nenhuma movimentação no período.</small>}
      </div>
    </article>
  );
}

function HighlightsIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m12 3 2.7 5.47 6.03.88-4.36 4.25 1.03 6-5.4-2.84L6.6 19.6l1.03-6-4.36-4.25 6.03-.88L12 3Z" />
    </svg>
  );
}

function CurrentMonthCashFlowPanel({ period, timeZone, movementsHref }: {
  period: FinanceOverviewDashboard["selectedPeriod"];
  timeZone: string;
  movementsHref: string;
}) {
  const summary = period.currentSummary;
  const movementCount = summary.currentMonthInflowsCount + summary.currentMonthOutflowsCount;
  return (
    <section className="fov-flow-layout">
      <article className="finance-panel fov-flow-panel">
        <header><div><h2>Fluxo do mês</h2><small>Somente movimentações realizadas em {monthLabel(period.month)}.</small></div></header>
        <div className="fov-flow-totals">
          <span><small>Entradas</small><strong className="positive"><Money value={summary.currentMonthInflows} /></strong></span>
          <span><small>Saídas</small><strong className="negative"><Money value={summary.currentMonthOutflows} /></strong></span>
          <span><small>Saldo em caixa</small><strong className="cash"><Money value={summary.closingBalance} /></strong></span>
        </div>
        {period.cashFlowSeries.length ? <AccountMovementChart data={period.cashFlowSeries} openingBalance={summary.openingBalance} />
          : <div className="fov-empty">Nenhuma movimentação neste período.</div>}
      </article>
      <aside className="finance-panel fov-highlights-panel" aria-label="Destaques do mês">
        <header><span className="fov-highlights-icon"><HighlightsIcon /></span><h2>Destaques do mês</h2></header>
        <div className="fov-highlights-list">
          <HighlightMovement direction="inflow" item={period.largestMovements.largestInflow} timeZone={timeZone} />
          <HighlightMovement direction="outflow" item={period.largestMovements.largestOutflow} timeZone={timeZone} />
        </div>
        <footer>
          <Link href={movementsHref} prefetch={false}>Ver todos os lançamentos <span aria-hidden="true">›</span></Link>
          <small>{movementCount} {movementCount === 1 ? "lançamento" : "lançamentos"} no período</small>
        </footer>
      </aside>
    </section>
  );
}

function InvoiceRows({ invoices, timeZone, empty }: {
  invoices: FinanceOverviewInvoice[];
  timeZone: string;
  empty: string;
}) {
  return invoices.length ? invoices.map(invoice => (
    <Link href={invoice.href} prefetch={false} className="fov-invoice-row" key={invoice.id}>
      <span><b>{invoice.name}{invoice.lastFour ? ` · ${invoice.lastFour}` : ""}</b><small>{invoice.closingDate ? `Fecha em ${dateLabel(invoice.closingDate, timeZone)}` : "Fechamento indisponível"}{invoice.dueDate ? ` · vence em ${dateLabel(invoice.dueDate, timeZone)}` : ""}</small></span>
      <strong>{invoice.amount === null ? "Valor indisponível" : <Money value={invoice.amount} />}</strong>
      <FinanceDataFreshnessBadge partial={invoice.partial} />
    </Link>
  )) : <div className="fov-empty compact">{empty}</div>;
}

const statusLabel = (status: string) => ({
  paid: "Pago", received: "Recebido", overdue: "Atrasado", late: "Atrasado",
  projected: "Pendente", pending: "Pendente", partially_paid: "Parcial",
} as Record<string, string>)[status] ?? status;

function CommitmentRows({ commitments, timeZone, empty }: {
  commitments: FinanceOverviewCommitment[];
  timeZone: string;
  empty: string;
}) {
  return commitments.length ? commitments.map(item => (
    <div className="fov-commitment-row" key={item.id}>
      <span><b>{item.title}</b><small>{item.context}{item.paymentSource ? ` · ${item.paymentSource}` : ""}</small></span>
      <time>{dateLabel(item.date, timeZone)}<small>{statusLabel(item.status)}</small></time>
      <strong><Money value={item.amount} /></strong>
    </div>
  )) : <div className="fov-empty compact">{empty}</div>;
}

function CurrentMonthInvoicesPanel({ invoices, timeZone, month }: {
  invoices: FinanceOverviewInvoice[];
  timeZone: string;
  month: string;
}) {
  return <article className="finance-panel fov-list-panel"><header><div><h2>Faturas do mês</h2><small>Ciclos relacionados a {monthLabel(month)}.</small></div><Link href="/financeiro/cartoes" prefetch={false}>Ver cartões</Link></header><InvoiceRows invoices={invoices} timeZone={timeZone} empty="Nenhuma fatura relacionada a este período." /></article>;
}

function CurrentMonthCommitmentsPanel({ commitments, timeZone, month }: {
  commitments: FinanceOverviewCommitment[];
  timeZone: string;
  month: string;
}) {
  return <article className="finance-panel fov-list-panel"><header><div><h2>Compromissos do mês</h2><small>Pagos, pendentes e atrasados em {monthLabel(month)}.</small></div><Link href={`/financeiro/receitas-despesas?month=${month}`} prefetch={false}>Ver detalhes</Link></header><CommitmentRows commitments={commitments} timeZone={timeZone} empty="Nenhum compromisso neste período." /></article>;
}

function CurrentMonthSpendingPanel({ period }: { period: FinanceOverviewDashboard["selectedPeriod"] }) {
  return <article className="finance-panel fov-spending"><header><h2>Para onde foi o dinheiro</h2>{period.uncategorizedCount ? <Link href="/financeiro/movimentacoes?review=pending" prefetch={false}>⚠ {period.uncategorizedCount} sem categoria</Link> : null}</header>{period.spendingDistribution.length ? period.spendingDistribution.slice(0, 5).map(item => <div className="fov-spending-row" key={item.key}><b>{item.label}</b><i><span style={{ width: `${Math.min(item.percentage, 100)}%` }} /></i><strong><Money value={item.amount} /></strong><small>{item.percentage.toFixed(1).replace(".", ",")}%</small></div>) : <div className="fov-empty compact">Categorize suas movimentações para visualizar a distribuição.</div>}</article>;
}

function CurrentMonthMovementsPanel({ period, month }: {
  period: FinanceOverviewDashboard["selectedPeriod"];
  month: string;
}) {
  return <article className="finance-panel fov-main-movements"><header><h2>Principais movimentos do mês</h2></header><div><section><h3>Entradas</h3>{period.mainMovements.inflows.map(item => <span key={item.id}><b>{item.title}</b><strong><Money value={item.amount} /></strong></span>)}<Link href={`/financeiro/movimentacoes?type=bank&period=custom&month=${month}`} prefetch={false}>Ver todas as entradas</Link></section><section><h3>Saídas</h3>{period.mainMovements.outflows.map(item => <span key={item.id}><b>{item.title}</b><strong><Money value={item.amount} /></strong></span>)}<Link href={`/financeiro/movimentacoes?type=bank&period=custom&month=${month}`} prefetch={false}>Ver todas as saídas</Link></section></div></article>;
}

function AttentionPanel({ title, items }: { title: string; items: FinanceAttentionItem[] }) {
  return <section className="finance-panel fov-attention"><header><h2>{title}</h2></header><div>{items.length ? items.map(item => <article className={item.severity} key={item.id}><i aria-hidden="true">!</i><b>{item.title}</b><Link href={item.href} prefetch={false}>{item.actionLabel}</Link></article>) : <p>Nenhuma situação financeira exige ação neste período.</p>}</div></section>;
}

function ProjectionCard({ title, value, detail, kind, action }: {
  title: string;
  value: number;
  detail: string;
  kind: "income" | "expense" | "result" | "free";
  action?: React.ReactNode;
}) {
  return <article className={`fov-projection-card ${kind}`} data-testid={`next-${kind}`}><span>{title}</span><strong className={kind === "expense" || value < 0 ? "negative" : "positive"}><Money value={value} /></strong><div className="fov-projection-card-footer"><small>{detail}</small>{action}</div></article>;
}

function NextMonthProjectionGrid({ period, timeZone }: {
  period: FinanceOverviewDashboard["nextPeriod"];
  timeZone: string;
}) {
  const projection = period.projectionSummary;
  return <section className="fov-next-grid" aria-label="Projeção do próximo mês"><ProjectionCard kind="income" title="Receitas previstas" value={projection.expectedIncome} detail={`${projection.incomeSources.length} fonte(s) planejada(s)`} /><ProjectionCard kind="expense" title="Despesas previstas" value={projection.expectedExpenses} detail={`${currency(projection.expectedCommitments)} em compromissos · ${currency(projection.expectedCardInvoices)} em faturas`} action={<NextMonthExpenseDetails month={period.month} projection={projection} expenses={period.expectedExpenses} invoices={period.upcomingInvoices} payrollDeductions={period.payrollDeductions} timeZone={timeZone} />} /><ProjectionCard kind="result" title="Resultado previsto" value={projection.expectedResult} detail="Receitas previstas menos despesas previstas" /><ProjectionCard kind="free" title="Livre estimado" value={projection.estimatedFreeAmount} detail={projection.estimatedFreeAmount < 0 ? "Próximo mês projetado no vermelho" : "Sobra prevista sem somar o saldo atual"} /></section>;
}

const estimationLabel = (method: string) => ({ fixed: "Fixo", historical_median: "Mediana", manual: "Manual" } as Record<string, string>)[method] ?? method;

function NextMonthIncomePanel({ period, timeZone }: {
  period: FinanceOverviewDashboard["nextPeriod"];
  timeZone: string;
}) {
  return <article className="finance-panel fov-forecast-list"><header><h2>Receitas previstas de {monthLabel(period.month).split(" de ")[0]}</h2></header>{period.expectedIncome.length ? period.expectedIncome.slice(0, 5).map(item => <div key={item.id}><span><b>{item.title}</b><small>{estimationLabel(item.estimationMethod)} · {dateLabel(item.expectedDate, timeZone)}</small></span><strong><Money value={item.amount} /></strong></div>) : <div className="fov-empty compact">Nenhuma receita prevista.</div>}</article>;
}

function NextMonthExpensesPanel({ period, timeZone }: {
  period: FinanceOverviewDashboard["nextPeriod"];
  timeZone: string;
}) {
  return <article className="finance-panel fov-forecast-list"><header><h2>Despesas previstas de {monthLabel(period.month).split(" de ")[0]}</h2></header>{period.expectedExpenses.length ? period.expectedExpenses.slice(0, 5).map(item => <div key={item.id}><span><b>{item.title}</b><small>{item.context} · {item.paymentChannel} · {dateLabel(item.expectedDate, timeZone)}</small></span><strong><Money value={item.amount} /></strong></div>) : <div className="fov-empty compact">Nenhuma despesa prevista.</div>}{period.payrollDeductions.length ? <p className="fov-payroll-note">Descontos em folha aparecem apenas como informação e não são abatidos novamente.</p> : null}</article>;
}

function FollowingMonthsSummary({ periods }: { periods: FinanceOverviewDashboard["followingPeriods"] }) {
  return <section className="finance-panel fov-projection"><header><h2>Meses seguintes</h2><small>Resumo após o próximo mês.</small></header><div>{periods.map(item => <article key={item.month}><h3>{monthLabel(item.month)}</h3><span><small>Receitas previstas</small><strong className="positive"><Money value={item.expectedIncome} /></strong></span><span><small>Despesas previstas</small><strong className="negative"><Money value={item.expectedExpenses} /></strong></span><span><small>Resultado previsto</small><strong className={item.expectedResult < 0 ? "negative" : "positive"}><Money value={item.expectedResult} /></strong></span></article>)}</div></section>;
}

function CurrentMonthSection({ period, timeZone, movementsHref }: {
  period: FinanceOverviewDashboard["selectedPeriod"];
  timeZone: string;
  movementsHref: string;
}) {
  const summary = period.currentSummary;
  return <section className="fov-period-section fov-current-period"><header className="fov-period-heading"><div><span>REALIZADO</span><h2>{periodTitle(period.month)} — Realizado</h2><p>O que realmente entrou e saiu neste período.</p></div><FinanceDataFreshnessBadge partial={summary.currentBalanceFreshness !== "complete"} updatedAt={summary.currentBalanceUpdatedAt} timeZone={timeZone} showComplete /></header><CurrentMonthSummaryGrid summary={summary} /><CurrentMonthCashFlowPanel period={period} timeZone={timeZone} movementsHref={movementsHref} /><section className="fov-two-column"><CurrentMonthInvoicesPanel invoices={period.currentInvoices} timeZone={timeZone} month={period.month} /><CurrentMonthCommitmentsPanel commitments={period.currentCommitments} timeZone={timeZone} month={period.month} /></section><section className="fov-two-column"><CurrentMonthSpendingPanel period={period} /><CurrentMonthMovementsPanel period={period} month={period.month} /></section><AttentionPanel title={`Atenção necessária em ${monthLabel(period.month).split(" de ")[0]}`} items={period.attentionItems} /></section>;
}

function NextMonthSection({ period, followingPeriods, timeZone }: {
  period: FinanceOverviewDashboard["nextPeriod"];
  followingPeriods: FinanceOverviewDashboard["followingPeriods"];
  timeZone: string;
}) {
  const shortMonth = monthLabel(period.month).split(" de ")[0];
  return <section className="fov-period-section fov-next-period"><header className="fov-period-heading"><div><span>PREVISÃO</span><h2>{monthLabel(period.month)} — previsão</h2><p>O que já está previsto para o próximo mês.</p></div></header><NextMonthProjectionGrid period={period} timeZone={timeZone} /><section className="fov-two-column"><NextMonthIncomePanel period={period} timeZone={timeZone} /><NextMonthExpensesPanel period={period} timeZone={timeZone} /></section><section className="fov-two-column"><article className="finance-panel fov-list-panel"><header><h2>Próximos compromissos de {shortMonth}</h2><Link href={`/financeiro/receitas-despesas?month=${period.month}`} prefetch={false}>Ver Receitas e Despesas</Link></header><CommitmentRows commitments={period.upcomingCommitments} timeZone={timeZone} empty="Nenhum compromisso próximo." /></article><article className="finance-panel fov-list-panel"><header><h2>Faturas previstas para {shortMonth}</h2><Link href="/financeiro/cartoes" prefetch={false}>Ver cartões</Link></header><InvoiceRows invoices={period.upcomingInvoices} timeZone={timeZone} empty="Nenhuma fatura prevista para este mês." /></article></section><AttentionPanel title={`Atenção para ${shortMonth}`} items={period.attentionItems} /><FollowingMonthsSummary periods={followingPeriods} /></section>;
}

export function FinanceOverview({
  dashboard, accounts, selectedAccountId, selectedMonth, maximumMonth,
  name, timeZone, workspace, today = new Date(),
}: {
  dashboard: FinanceOverviewDashboard;
  accounts: FinancialAccount[];
  selectedAccountId?: string;
  selectedMonth: string;
  maximumMonth?: string;
  name: string;
  timeZone: string;
  workspace: string;
  today?: Date;
}) {
  const movementsQuery = new URLSearchParams({
    type: "bank",
    period: "custom",
    month: selectedMonth,
    workspace,
  });
  if (selectedAccountId) movementsQuery.set("account", selectedAccountId);
  const movementsHref = `/financeiro/movimentacoes?${movementsQuery.toString()}`;
  return (
    <ValueVisibility controls={false}>
      <main className="finance-overview fov-dashboard">
        <header className="fov-header"><div><p className="eyebrow">VISÃO GERAL</p><h1>{greeting(timeZone, today)}, {name}!</h1><p>Sua posição financeira em {monthLabel(selectedMonth)}.</p></div><FinanceAccountFilters accounts={accounts} accountId={selectedAccountId} month={selectedMonth} maximumMonth={maximumMonth} workspace={workspace} /></header>
        <CurrentMonthSection period={dashboard.selectedPeriod} timeZone={timeZone} movementsHref={movementsHref} />
        <NextMonthSection period={dashboard.nextPeriod} followingPeriods={dashboard.followingPeriods} timeZone={timeZone} />
      </main>
    </ValueVisibility>
  );
}
