"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { IncomeExpenseListItem } from "@/modules/finance/income-expenses-query";
import type {
  CanonicalFinancialEvent,
  IncomeExpenseDashboard,
} from "@/modules/finance/income-expense-dashboard";

const money = (cents: number) => new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
}).format(cents / 100);

const compactMoney = (cents: number) => cents >= 100000
  ? `R$ ${new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 }).format(cents / 100000)} mil`
  : money(cents);

const dateLabel = (date: string | null) => date
  ? new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", timeZone: "America/Sao_Paulo" })
    .format(new Date(`${date}T12:00:00Z`)).replace(".", "")
  : "Sem data";

const statusLabels: Record<string, string> = {
  projected: "A receber",
  expected: "A receber",
  pending: "A pagar",
  partially_received: "Parcialmente recebida",
  partially_paid: "Parcialmente paga",
  received: "Recebida",
  paid: "Paga",
  above_expected: "Acima do esperado",
  below_expected: "Abaixo do esperado",
  overdue: "Atrasada",
};

function KpiCard({
  kind,
  title,
  value,
  description,
  progress,
}: {
  kind: "income" | "expense" | "neutral";
  title: string;
  value: number;
  description: string;
  progress?: number;
}) {
  return (
    <article className={`ied-kpi ied-kpi-${kind}`}>
      <div className="ied-kpi-title">
        <i aria-hidden="true" />
        <span>{title}</span>
      </div>
      <strong>{money(value)}</strong>
      <p>{description}</p>
      {progress !== undefined ? (
        <div className="ied-progress" aria-label={`${progress.toFixed(1)}%`}>
          <i style={{ width: `${Math.min(100, progress)}%` }} />
          <small>{progress.toFixed(1).replace(".", ",")}% do esperado</small>
        </div>
      ) : null}
    </article>
  );
}

function MonthlyCashFlowChart({ dashboard }: { dashboard: IncomeExpenseDashboard }) {
  const hasValues = dashboard.cumulativeSeries.some(item =>
    item.cumulativeIncome > 0 || item.cumulativeExpenses > 0
  );
  return (
    <section className="ied-panel ied-chart-panel" data-testid="monthly-cash-flow-chart">
      <header>
        <div><h2>Visão do mês</h2><p>Receitas e despesas acumuladas ao longo do mês.</p></div>
        <div className="ied-chart-legend">
          <span className="income">Receitas</span><span className="expense">Despesas</span>
        </div>
      </header>
      {hasValues ? (
        <div className="ied-chart">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={dashboard.cumulativeSeries} margin={{ top: 12, right: 12, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="incomeFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#4ed6a0" stopOpacity={0.28} />
                  <stop offset="100%" stopColor="#4ed6a0" stopOpacity={0.02} />
                </linearGradient>
                <linearGradient id="expenseFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#ff6f7d" stopOpacity={0.22} />
                  <stop offset="100%" stopColor="#ff6f7d" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="var(--atlas-border)" vertical={false} strokeDasharray="3 5" />
              <XAxis dataKey="day" tickLine={false} axisLine={false} minTickGap={24} tick={{ fill: "var(--atlas-muted)", fontSize: 12 }} />
              <YAxis tickFormatter={value => compactMoney(Number(value))} tickLine={false} axisLine={false} width={64} tick={{ fill: "var(--atlas-muted)", fontSize: 12 }} />
              <Tooltip
                formatter={(value, name) => [money(Number(value ?? 0)), name === "cumulativeIncome" ? "Receitas" : "Despesas"]}
                labelFormatter={label => `Dia ${label}`}
                contentStyle={{ background: "var(--atlas-surface-solid)", border: "1px solid var(--atlas-border)", borderRadius: 10, fontSize: 14 }}
              />
              <Area type="monotone" dataKey="cumulativeIncome" stroke="#4ed6a0" fill="url(#incomeFill)" strokeWidth={2.2} />
              <Area type="monotone" dataKey="cumulativeExpenses" stroke="#ff6f7d" fill="url(#expenseFill)" strokeWidth={2.2} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      ) : <div className="ied-empty"><b>Sem valores realizados neste mês</b><span>O gráfico será preenchido conforme os pagamentos e recebimentos forem confirmados.</span></div>}
    </section>
  );
}

type EventFilter = "all" | "income" | "expense" | "pending" | "realized";

const isRealized = (event: CanonicalFinancialEvent) =>
  ["paid", "received", "above_expected", "below_expected"].includes(event.status);

const eventStatusLabel = (event: CanonicalFinancialEvent) => {
  if (["projected", "expected", "pending"].includes(event.status)) {
    return event.kind === "income" ? "A receber" : "A pagar";
  }
  return statusLabels[event.status] ?? event.status;
};

function FinancialEventsPanel({
  dashboard,
  items,
  onOpen,
}: {
  dashboard: IncomeExpenseDashboard;
  items: IncomeExpenseListItem[];
  onOpen: (item: IncomeExpenseListItem) => void;
}) {
  const [filter, setFilter] = useState<EventFilter>("all");
  const [showAll, setShowAll] = useState(false);
  const matchingEvents = useMemo(() => dashboard.financialEvents.filter(event => {
    if (filter === "income" || filter === "expense") return event.kind === filter;
    if (filter === "pending") return !isRealized(event);
    if (filter === "realized") return isRealized(event);
    return true;
  }), [dashboard.financialEvents, filter]);
  const filtered = showAll ? matchingEvents : matchingEvents.slice(0, 6);
  const openEvent = (event: CanonicalFinancialEvent) => {
    const item = items.find(candidate =>
      (candidate.occurrenceId ?? `${candidate.id}:${candidate.competenceMonth}`) === event.id
    );
    if (item) onOpen(item);
  };
  return (
    <section className="ied-panel ied-events" data-testid="financial-events-panel">
      <header><div><h2>Eventos financeiros do mês</h2><p>Previsões e realizações mais relevantes.</p></div></header>
      <div className="ied-event-filters" aria-label="Filtrar eventos">
        {(["all", "income", "expense", "pending", "realized"] as const).map(value => (
          <button key={value} type="button" className={filter === value ? "active" : ""} onClick={() => setFilter(value)}>
            {{ all: "Todos", income: "Receitas", expense: "Despesas", pending: "Pendentes", realized: "Realizados" }[value]}
          </button>
        ))}
      </div>
      <div className="ied-event-head" aria-hidden="true">
        <span>Data</span><span>Descrição</span><span>Tipo</span><span>Esperado</span><span>Recebido / Pago</span><span>Status</span>
      </div>
      <div className="ied-event-list">
        {filtered.length ? filtered.map(event => (
          <button type="button" key={event.id} onClick={() => openEvent(event)} className={`ied-event-row ${event.kind}`}>
            <time>{dateLabel(event.expectedDate)}</time>
            <span><b>{event.title}</b>{event.person ? <small>{event.person}</small> : null}</span>
            <em>{event.kind === "income" ? "Receita" : "Despesa"}</em>
            <span>{money(event.expectedAmount)}</span>
            <strong>{money(event.realizedAmount)}</strong>
            <i className={`status-${event.status}`}>{eventStatusLabel(event)}</i>
          </button>
        )) : <div className="ied-empty compact"><b>Nenhum evento neste filtro</b><span>Escolha outro filtro para continuar.</span></div>}
      </div>
      {matchingEvents.length > 6 ? (
        <button type="button" className="ied-panel-link" onClick={() => setShowAll(value => !value)}>
          {showAll ? "Mostrar menos" : "Ver todos os eventos"} <span>›</span>
        </button>
      ) : null}
    </section>
  );
}

function PayrollDeductionsSummary({ dashboard, onOpen }: {
  dashboard: IncomeExpenseDashboard;
  onOpen: () => void;
}) {
  if (dashboard.summary.payrollDeductionsTotal <= 0) return null;
  return (
    <section className="ied-payroll" data-testid="payroll-deductions-summary">
      <div><i aria-hidden="true">▤</i><span><b>Descontos em folha</b><small>Já considerados na renda líquida</small></span></div>
      <strong>{money(dashboard.summary.payrollDeductionsTotal)}</strong>
      <button type="button" onClick={onOpen}>Ver composição <span>›</span></button>
    </section>
  );
}

function ExpenseContextDistribution({ dashboard }: { dashboard: IncomeExpenseDashboard }) {
  return (
    <section className="ied-panel ied-distribution" data-testid="expense-context-distribution">
      <header><div><h2>Distribuição</h2><p>Despesas pagas por contexto.</p></div></header>
      {dashboard.contextDistribution.length ? (
        <div>{dashboard.contextDistribution.slice(0, 4).map(item => (
          <article key={item.key}>
            <span><b>{item.label}</b><small>{money(item.amount)}</small><em>{item.percentage.toFixed(1).replace(".", ",")}%</em></span>
            <i><span style={{ width: `${item.percentage}%` }} /></i>
          </article>
        ))}</div>
      ) : <div className="ied-empty compact"><b>Sem despesas realizadas</b><span>A distribuição aparecerá quando houver pagamentos.</span></div>}
    </section>
  );
}

function TopLists({ dashboard, query }: { dashboard: IncomeExpenseDashboard; query: string }) {
  return (
    <section className="ied-panel ied-top-lists">
      <div data-testid="top-income-list">
        <h2>Principais receitas</h2>
        {dashboard.topIncome.length ? dashboard.topIncome.map(item => (
          <span key={item.id}><i className="income" /><b>{item.title}</b><strong>{money(item.amount)}</strong></span>
        )) : <p>Nenhuma receita recebida.</p>}
        <Link href={`?${query}&tab=income`}>Ver todas as receitas <span>›</span></Link>
      </div>
      <div data-testid="top-expense-list">
        <h2>Maiores despesas</h2>
        {dashboard.topExpenses.length ? dashboard.topExpenses.map(item => (
          <span key={item.id}><i className="expense" /><b>{item.title}</b><strong>{money(item.amount)}</strong></span>
        )) : <p>Nenhuma despesa paga.</p>}
        <Link href={`?${query}&tab=expenses`}>Ver todas as despesas <span>›</span></Link>
      </div>
    </section>
  );
}

export function IncomeExpenseDashboardView({
  dashboard,
  items,
  onOpenItem,
  onOpenPayroll,
  query,
}: {
  dashboard: IncomeExpenseDashboard;
  items: IncomeExpenseListItem[];
  onOpenItem: (item: IncomeExpenseListItem) => void;
  onOpenPayroll: () => void;
  query: string;
}) {
  const summary = dashboard.summary;
  return (
    <div className="ied-dashboard" data-testid="income-expense-dashboard">
      <section className="ied-kpi-grid" aria-label="Resumo financeiro do mês">
        <KpiCard kind="income" title="Receitas" value={summary.receivedIncome}
          description={`recebidos de ${money(summary.expectedIncome)} esperados`} progress={summary.incomeProgressPercentage} />
        <KpiCard kind="expense" title="Despesas" value={summary.paidExpenses}
          description={`${money(summary.remainingExpectedExpenses)} ainda previstas`}
          progress={summary.totalExpectedCashExpenses > 0 ? summary.expenseProgressPercentage : undefined} />
        <KpiCard kind="neutral" title="Resultado realizado" value={summary.realizedResult}
          description="receitas recebidas − despesas pagas" />
        <KpiCard kind="neutral" title="Resultado previsto" value={summary.projectedResult}
          description="receitas esperadas − despesas previstas" />
      </section>
      <div className="ied-main-grid">
        <MonthlyCashFlowChart dashboard={dashboard} />
        <FinancialEventsPanel dashboard={dashboard} items={items} onOpen={onOpenItem} />
      </div>
      <PayrollDeductionsSummary dashboard={dashboard} onOpen={onOpenPayroll} />
      <div className="ied-bottom-grid">
        <ExpenseContextDistribution dashboard={dashboard} />
        <TopLists dashboard={dashboard} query={query} />
      </div>
    </div>
  );
}
