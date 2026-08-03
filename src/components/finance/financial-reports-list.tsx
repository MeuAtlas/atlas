import Link from "next/link";

import { Money } from "./value-visibility";
import { AtlasText } from "@/components/ui/atlas-text";
import {
  getFinancialMonthAction,
  type ActiveFinancialMonth,
  type ClosedFinancialMonth,
  type FinancialMonthCardState,
  type FinancialMonthDisplayStatus,
} from "@/modules/finance/financial-reports-list";
import type { MonthlyReportSnapshot } from "@/modules/finance/monthly-financial-report";

const monthLabel = (year: number, month: number) =>
  new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" })
    .format(new Date(Date.UTC(year, month - 1, 1)));
const dateLabel = (value: string) =>
  new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Fortaleza" }).format(new Date(value));

const statusLabels: Record<FinancialMonthDisplayStatus, string> = {
  planned: "Planejado",
  open: "Em andamento",
  review: "Pronto para revisão",
  closed: "Concluído",
  reopened: "Reaberto para correção",
  needs_attention: "Precisa de atenção",
};

export function FinancialMonthStatus({ status }: { status: FinancialMonthDisplayStatus }) {
  return <span className={`financial-month-status ${status}`}><i />{statusLabels[status]}</span>;
}

export function FinancialMonthSummary({ item }: { item: ActiveFinancialMonth }) {
  if (item.displayStatus === "planned") {
    return <div className="financial-month-summary planned"><strong>Ainda não iniciado</strong><small>Sem movimentações fictícias</small></div>;
  }
  const current = item.displayStatus === "open";
  return <dl className="financial-month-summary"><div><dt>{current ? "Resultado até agora" : "Resultado do mês"}</dt><AtlasText as="dd" variant="financialValueSmall"><Money value={item.snapshot.totals.cashResult} /></AtlasText></div><div><dt>{current ? "Saldo atual" : "Saldo final"}</dt><AtlasText as="dd" variant="financialValueSmall"><Money value={item.snapshot.totals.closingBalance} /></AtlasText></div></dl>;
}

export function FinancialMonthCardSummary({ card }: { card: FinancialMonthCardState }) {
  if (card.kind === "paid") return <div className="financial-month-card-summary"><span>Pago</span><strong><Money value={card.paid} /></strong></div>;
  if (card.kind === "partial") return <div className="financial-month-card-summary warning"><span>Pago parcialmente</span><strong><Money value={card.paid} /> de <Money value={card.expected} /></strong></div>;
  if (card.kind === "identified") return <div className="financial-month-card-summary warning"><span>Pagamento identificado</span><strong>A confirmar</strong></div>;
  if (card.kind === "forecast") return <div className="financial-month-card-summary"><span>Previsão</span><strong><Money value={card.forecast} /></strong><small>Aguardando pagamento</small></div>;
  return <div className="financial-month-card-summary muted"><span>Sem previsão disponível</span></div>;
}

export function FinancialMonthAction({ item, href }: { item: ActiveFinancialMonth; href: string }) {
  const emphasized = ["review", "needs_attention"].includes(item.displayStatus);
  return <Link className={`financial-month-action${emphasized ? " primary" : ""}`} href={href} prefetch={false}>{getFinancialMonthAction(item.displayStatus)}</Link>;
}

export function ActiveFinancialMonthRow({ item, href }: { item: ActiveFinancialMonth; href: string }) {
  return <article className="active-financial-month-row"><div className="financial-month-name"><AtlasText as="strong" variant="tableBody" className="capitalize">{monthLabel(item.month.reference_year, item.month.reference_month)}</AtlasText><FinancialMonthStatus status={item.displayStatus} /></div><FinancialMonthSummary item={item} /><FinancialMonthCardSummary card={item.card} /><FinancialMonthAction item={item} href={href} /></article>;
}

export function ActiveFinancialMonthCard(props: { item: ActiveFinancialMonth; href: string }) {
  return <ActiveFinancialMonthRow {...props} />;
}

export function ActiveFinancialMonths({ items, hrefFor }: { items: ActiveFinancialMonth[]; hrefFor: (item: ActiveFinancialMonth) => string }) {
  return <section className="active-financial-months finance-panel" aria-labelledby="active-financial-months-title"><header><div><AtlasText variant="label">Agora</AtlasText><h2 id="active-financial-months-title">Acompanhamento atual</h2></div><small>Somente os meses que precisam de acompanhamento, revisão ou planejamento.</small></header><div className="active-financial-months-head"><AtlasText variant="tableHeader">Mês</AtlasText><AtlasText variant="tableHeader">Como está</AtlasText><AtlasText variant="tableHeader">Cartão do mês</AtlasText><AtlasText variant="tableHeader">Ação</AtlasText></div><div>{items.map(item => <ActiveFinancialMonthCard key={item.month.id} item={item} href={hrefFor(item)} />)}</div></section>;
}

export function ClosedReportActions({ item, href }: { item: ClosedFinancialMonth; href: string }) {
  return <div className="closed-report-actions"><Link href={href} prefetch={false}>Ver relatório</Link>{item.report?.pdf_storage_path ? <Link href={`/api/monthly-reports/${item.report.id}/pdf`} prefetch={false}>PDF</Link> : null}</div>;
}

export function ClosedFinancialReportRow({ item, href }: { item: ClosedFinancialMonth; href: string }) {
  const historyStatus = item.month.status === "reopened" ? "reopened" : "closed";
  return <article className="closed-financial-report-row"><div><strong className="capitalize">{monthLabel(item.month.reference_year, item.month.reference_month)}</strong><FinancialMonthStatus status={historyStatus} /></div><span>Concluído em <b>{item.month.closed_at ? dateLabel(item.month.closed_at) : "data indisponível"}</b></span><span>Versão preservada <b>{item.report?.version ?? "—"}</b></span><ClosedReportActions item={item} href={href} /></article>;
}

export function ClosedFinancialReports({ items, total, hrefFor }: { items: ClosedFinancialMonth[]; total: number; hrefFor: (item: ClosedFinancialMonth) => string }) {
  return <section className="closed-financial-reports finance-panel" aria-labelledby="closed-financial-reports-title"><header><div><AtlasText variant="label">Histórico preservado</AtlasText><h2 id="closed-financial-reports-title">Relatórios concluídos</h2></div><small>{total > items.length ? `Últimos ${items.length} de ${total} relatórios` : `${total} relatório(s)`}</small></header>{items.length ? <div>{items.map(item => <ClosedFinancialReportRow key={item.month.id} item={item} href={hrefFor(item)} />)}</div> : <p>Nenhum relatório foi concluído neste período.</p>}</section>;
}

export function PlannedFinancialMonth(props: { item: ActiveFinancialMonth; href: string }) {
  return <ActiveFinancialMonthCard {...props} />;
}

export function PlannedFinancialMonthOverview({ snapshot, card }: { snapshot: MonthlyReportSnapshot; card: FinancialMonthCardState }) {
  const firstProjection = snapshot.projection?.[0];
  const knownCommitments = firstProjection
    ? Math.max(firstProjection.total, firstProjection.installments + firstProjection.recurring + firstProjection.other + (firstProjection.card ?? 0))
    : snapshot.totals.futureCommitments ?? 0;
  return <section className="finance-panel planned-financial-month-overview"><header><div><AtlasText variant="label">Planejamento</AtlasText><h2>Ainda não iniciado</h2></div></header><p>Este mês não possui resultado em caixa. O Atlas mostra somente compromissos e previsões já conhecidos, sem criar movimentações fictícias.</p><div><span>Saldo de abertura estimado<strong><Money value={snapshot.totals.openingBalance} /></strong></span><span>Compromissos conhecidos<strong><Money value={knownCommitments} /></strong></span><span>Cartão do mês<FinancialMonthCardSummary card={card} /></span></div></section>;
}
