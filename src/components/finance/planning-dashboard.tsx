"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ClientSearchForm } from "@/components/navigation/client-navigation";
import {
  AtlasModal,
  AtlasModalBody,
  AtlasModalClose,
  AtlasModalFooter,
  AtlasModalHeader,
} from "@/components/ui/atlas-modal";
import type {
  CanonicalPlanningItem,
  PlanningConfidence,
  PlanningDashboard,
  PlanningNextMonthSummary as PlanningSummary,
  PlanningPriority,
} from "@/modules/finance/planning-dashboard";

const currency = (value: number) => new Intl.NumberFormat("pt-BR", {
  style: "currency", currency: "BRL",
}).format(value);
const compact = (value: number) => new Intl.NumberFormat("pt-BR", {
  notation: "compact", maximumFractionDigits: 1,
}).format(value);
const monthLabel = (value: string) => new Intl.DateTimeFormat("pt-BR", {
  month: "long", year: "numeric", timeZone: "UTC",
}).format(new Date(`${value.slice(0, 7)}-01T12:00:00Z`));
const shortMonth = (value: string) => new Intl.DateTimeFormat("pt-BR", {
  month: "short", timeZone: "UTC",
}).format(new Date(`${value.slice(0, 7)}-01T12:00:00Z`)).replace(".", "");
const dateLabel = (value: string | null) => value
  ? new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "UTC" }).format(new Date(`${value.slice(0, 10)}T12:00:00Z`))
  : "Ao longo do mês";
const confidenceLabel = (value: PlanningConfidence) => ({ high: "Alta", medium: "Média", low: "Baixa" } as const)[value];
const methodLabel = (value: string) => ({ fixed: "Valor fixo", historical_median: "Mediana histórica", manual: "Ajustada" } as Record<string, string>)[value] ?? value;
const priorityLabel = (value: PlanningPriority) => ({ essential: "Essenciais", adjustable: "Ajustáveis", optional: "Opcionais", unclassified: "Não classificados" } as const)[value];

export function PlanningDataFreshnessBadge({ confidence }: { confidence: PlanningConfidence }) {
  return <span className={`planning-confidence ${confidence}`}>Confiança {confidenceLabel(confidence).toLocaleLowerCase("pt-BR")}</span>;
}

export function PlanningFilters({ dashboard }: { dashboard: PlanningDashboard }) {
  const filters = dashboard.filters;
  return (
    <ClientSearchForm action="/financeiro/planejamento" className="planning-filters">
      <input type="hidden" name="workspace" value={filters.workspaceId} />
      <label><span>Mês inicial</span><input type="month" name="month" defaultValue={filters.startMonth} /></label>
      <label><span>Horizonte</span><select name="horizon" defaultValue={filters.horizon}><option value="3">3 meses</option><option value="6">6 meses</option><option value="12">12 meses</option></select></label>
      <label><span>Conta</span><select name="account" defaultValue={filters.accountId ?? "all"}><option value="all">Consolidado</option>{filters.accounts.map(account => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label>
      <button type="submit">Aplicar</button>
    </ClientSearchForm>
  );
}

export function PlanningPageHeader({ dashboard }: { dashboard: PlanningDashboard }) {
  return <header className="planning-header"><div><p className="eyebrow">PLANEJAMENTO</p><h1>Planejamento financeiro</h1><p>Veja quanto deve entrar, quanto já está comprometido e quanto pode sobrar nos próximos meses.</p></div><PlanningFilters dashboard={dashboard} /></header>;
}

export function PlanningSummaryCard({ title, value, detail, kind }: { title: string; value: string; detail: string; kind: string }) {
  return <article className={`planning-summary-card ${kind}`}><span>{title}</span><strong>{value}</strong><small>{detail}</small></article>;
}

export function PlanningNextMonthSummary({ summary }: { summary: PlanningSummary }) {
  return <section className="planning-section"><header><div><h2>{monthLabel(summary.month)} — previsão</h2><p>Resumo do próximo mês com base nas receitas e compromissos conhecidos.</p></div><PlanningDataFreshnessBadge confidence={summary.confidence} /></header><div className="planning-summary-grid"><PlanningSummaryCard title="Receitas previstas" value={currency(summary.expectedIncome)} detail={`${summary.expectedIncomeSourcesCount} fontes de receita`} kind="income" /><PlanningSummaryCard title="Despesas previstas" value={currency(summary.expectedExpenses)} detail={`${summary.expectedExpensesCount} compromissos conhecidos`} kind="expense" /><PlanningSummaryCard title="Livre estimado" value={currency(summary.estimatedFreeAmount)} detail={summary.estimatedFreeAmount >= 0 ? "Pode sobrar neste mês." : "Mês projetado no vermelho."} kind={summary.estimatedFreeAmount >= 0 ? "free" : "negative"} /><PlanningSummaryCard title="Renda comprometida" value={summary.committedPercentage === null ? "Sem base de renda" : `${summary.committedPercentage.toFixed(1).replace(".", ",")}%`} detail={`${currency(summary.expectedExpenses)} de ${currency(summary.expectedIncome)} comprometidos`} kind="committed" /></div></section>;
}

export function PlanningProjectionChart({ dashboard }: { dashboard: PlanningDashboard }) {
  const data = dashboard.projectionSeries.map(item => ({ ...item, label: shortMonth(item.month) }));
  return <div className="planning-chart" role="img" aria-label="Receitas, despesas e valor livre previstos por mês"><ResponsiveContainer width="100%" height="100%"><ComposedChart data={data} margin={{ top: 12, right: 8, left: -12, bottom: 0 }}><CartesianGrid vertical={false} stroke="var(--atlas-chart-grid)" /><XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fill: "var(--atlas-chart-axis)", fontSize: 13 }} /><YAxis axisLine={false} tickLine={false} tickFormatter={compact} tick={{ fill: "var(--atlas-chart-axis)", fontSize: 12 }} /><Tooltip formatter={(value) => currency(Number(value))} contentStyle={{ background: "var(--atlas-tooltip-background)", border: "1px solid var(--atlas-tooltip-border)", borderRadius: 12, color: "var(--atlas-tooltip-text)" }} /><Bar dataKey="expectedIncome" name="Receitas previstas" fill="var(--atlas-success)" radius={[5,5,0,0]} /><Bar dataKey="expectedExpenses" name="Despesas previstas" fill="var(--atlas-error)" radius={[5,5,0,0]} /><Line type="monotone" dataKey="estimatedFreeAmount" name="Livre estimado" stroke="var(--atlas-blue)" strokeWidth={3} dot={{ r: 3, fill: "var(--atlas-blue)" }} /></ComposedChart></ResponsiveContainer></div>;
}

export function PlanningMonthlySummaryList({ dashboard, onOpen }: { dashboard: PlanningDashboard; onOpen: (index: number) => void }) {
  return <div className="planning-month-list">{dashboard.monthlySummaries.map((month, index) => <button type="button" key={month.summary.month} onClick={() => onOpen(index)}><b>{monthLabel(month.summary.month)}</b><span><small>Receitas</small><strong className="positive">{currency(month.summary.expectedIncome)}</strong></span><span><small>Despesas</small><strong className="negative">{currency(month.summary.expectedExpenses)}</strong></span><span><small>Livre</small><strong className={month.summary.estimatedFreeAmount < 0 ? "negative" : "positive"}>{currency(month.summary.estimatedFreeAmount)}</strong></span><span><small>Comprometido</small><strong>{month.summary.committedPercentage === null ? "—" : `${Math.round(month.summary.committedPercentage)}%`}</strong></span><i aria-hidden="true">›</i></button>)}</div>;
}

function ItemList({ items, empty }: { items: CanonicalPlanningItem[]; empty: string }) {
  return items.length ? <div className="planning-item-list">{items.map(item => <article key={item.canonicalId}><div><b>{item.title}</b><small>{methodLabel(item.method)} · {dateLabel(item.expectedDate)}</small><small>{item.context}{item.paymentMethod ? ` · ${item.paymentMethod}` : ""}</small></div><strong>{currency(item.planningAmount || item.expectedAmount)}</strong>{item.method === "manual" ? <em>Ajustada</em> : null}</article>)}</div> : <div className="planning-empty compact"><b>{empty}</b><p>Ainda não há dados suficientes para esta composição.</p></div>;
}

export function PlanningIncomePanel({ items, onOpen }: { items: CanonicalPlanningItem[]; onOpen: () => void }) {
  return <article className="planning-composition-panel"><header><h2>Receitas previstas</h2><span>{currency(items.reduce((sum, item) => sum + item.planningAmount, 0))}</span></header><ItemList items={items.slice(0, 5)} empty="Nenhuma receita prevista" /><button type="button" onClick={onOpen}>Ver composição completa</button></article>;
}

export function PlanningExpensesPanel({ items, onOpen }: { items: CanonicalPlanningItem[]; onOpen: () => void }) {
  return <article className="planning-composition-panel"><header><h2>Despesas previstas</h2><span>{currency(items.reduce((sum, item) => sum + item.planningAmount, 0))}</span></header><ItemList items={items.slice(0, 5)} empty="Nenhuma despesa prevista" /><button type="button" onClick={onOpen}>Ver composição completa</button></article>;
}

export function PlanningCommitmentBreakdown({ dashboard }: { dashboard: PlanningDashboard }) {
  return <section className="planning-section planning-breakdown-section"><header><div><h2>Comprometimento da renda</h2><p>Quanto é obrigatório, quanto pode ser ajustado e quanto ainda não foi classificado.</p></div></header><div>{dashboard.incomeCommitmentBreakdown.map(item => <article key={item.priority}><span><b>{priorityLabel(item.priority)}</b><small>{item.percentage === null ? "Sem base de renda" : `${item.percentage.toFixed(1).replace(".", ",")}% da renda`}</small></span><strong>{currency(item.amount)}</strong><i><span style={{ width: `${Math.min(item.percentage ?? 0, 100)}%` }} /></i></article>)}</div></section>;
}

export function PlanningPayrollSummary({ items, onOpen }: { items: CanonicalPlanningItem[]; onOpen: () => void }) {
  if (!items.length) return null;
  const total = items.reduce((sum, item) => sum + item.expectedAmount, 0);
  return <div className="planning-payroll-summary"><span><b>Descontos em folha já considerados</b><small>Não reduzem novamente o livre estimado.</small></span><strong>{currency(total)}</strong><button type="button" onClick={onOpen}>Ver detalhes</button></div>;
}

export function PlanningAttentionPanel({ dashboard }: { dashboard: PlanningDashboard }) {
  return <section className="planning-section planning-attention"><header><div><h2>Atenção no planejamento</h2><p>Somente pontos que podem alterar a projeção.</p></div></header>{dashboard.attentionItems.length ? <div>{dashboard.attentionItems.map(item => <article className={item.severity} key={item.id}><i aria-hidden="true">!</i><span><b>{item.title}</b><small>{item.description}</small></span><Link href={item.href} prefetch={false}>{item.actionLabel}</Link></article>)}</div> : <p className="planning-all-clear">Nenhum ponto exige revisão neste momento.</p>}</section>;
}

export function PlanningMonthDetailsModal({ dashboard, index, onClose }: { dashboard: PlanningDashboard; index: number | null; onClose: () => void }) {
  const month = index === null ? null : dashboard.monthlySummaries[index];
  if (!month) return null;
  const incomes = month.items.filter(item => item.kind === "income");
  const expenses = month.items.filter(item => ["expense", "installment", "loan"].includes(item.kind) && !item.includedInInvoice && item.planningAmount > 0);
  const invoices = month.items.filter(item => item.kind === "invoice");
  const payroll = month.items.filter(item => item.kind === "payroll");
  return <AtlasModal open onClose={onClose} title={`Composição de ${monthLabel(month.summary.month)}`} size="large"><AtlasModalHeader><div><p className="eyebrow">COMPOSIÇÃO DO MÊS</p><h2>Composição de {monthLabel(month.summary.month)}</h2><p>Valores canônicos usados na projeção, sem duplicidades.</p></div><AtlasModalClose /></AtlasModalHeader><AtlasModalBody className="planning-modal-body"><section><h3>Receitas</h3><ItemList items={incomes} empty="Nenhuma receita prevista" /></section><section><h3>Despesas</h3><ItemList items={expenses} empty="Nenhuma despesa prevista" /></section>{invoices.length ? <section><h3>Faturas</h3><ItemList items={invoices} empty="Nenhuma fatura prevista" /></section> : null}{payroll.length ? <section className="planning-modal-payroll"><h3>Descontos em folha</h3><ItemList items={payroll} empty="Nenhum desconto" /><p>Já considerados antes da renda líquida ser creditada e não reduzem novamente o livre estimado.</p></section> : null}<section className="planning-modal-summary"><h3>Resumo</h3><div><span>Receitas <b>{currency(month.summary.expectedIncome)}</b></span><span>Despesas <b>{currency(month.summary.expectedExpenses)}</b></span><span>Livre <b>{currency(month.summary.estimatedFreeAmount)}</b></span><span>Comprometido <b>{month.summary.committedPercentage === null ? "—" : `${month.summary.committedPercentage.toFixed(1).replace(".", ",")}%`}</b></span></div></section></AtlasModalBody><AtlasModalFooter><button type="button" onClick={onClose}>Fechar</button></AtlasModalFooter></AtlasModal>;
}

export function PlanningEmptyState() {
  return <section className="planning-empty"><b>Ainda não há dados suficientes para gerar uma projeção confiável.</b><p>Cadastre uma receita e compromissos futuros para começar.</p><div><Link href="/financeiro/receitas-despesas" prefetch={false}>Adicionar receita ou despesa</Link></div></section>;
}

export function PlanningDashboardView({ dashboard }: { dashboard: PlanningDashboard }) {
  const [selectedMonth, setSelectedMonth] = useState<number | null>(null);
  const empty = !dashboard.nextMonthSummary.expectedIncome && !dashboard.nextMonthSummary.expectedExpenses;
  const projectionTitle = useMemo(() => `Projeção de ${dashboard.filters.horizon} meses`, [dashboard.filters.horizon]);
  return <main className="planning-dashboard"><PlanningPageHeader dashboard={dashboard} />{empty ? <PlanningEmptyState /> : <><PlanningNextMonthSummary summary={dashboard.nextMonthSummary} /><section className="planning-section"><header><div><h2>Projeção dos próximos meses</h2><p>Compare receitas, despesas e valor livre ao longo do período selecionado.</p></div><span>{projectionTitle}</span></header><PlanningProjectionChart dashboard={dashboard} /><PlanningMonthlySummaryList dashboard={dashboard} onOpen={setSelectedMonth} /></section><section className="planning-section" id="composicao"><header><div><h2>Composição do próximo mês</h2><p>As principais fontes e compromissos que formam a projeção.</p></div></header><div className="planning-composition-grid"><PlanningIncomePanel items={dashboard.nextMonthIncome} onOpen={() => setSelectedMonth(0)} /><PlanningExpensesPanel items={dashboard.nextMonthExpenses} onOpen={() => setSelectedMonth(0)} /></div></section><PlanningCommitmentBreakdown dashboard={dashboard} /><PlanningPayrollSummary items={dashboard.payrollDeductionsInformational} onOpen={() => setSelectedMonth(0)} /><PlanningAttentionPanel dashboard={dashboard} /></>}<PlanningMonthDetailsModal dashboard={dashboard} index={selectedMonth} onClose={() => setSelectedMonth(null)} /></main>;
}
