import Link from "next/link";

import { Money } from "./value-visibility";
import { AccountMovementChart } from "./overview-charts";
import type { FinancialMonthRecord, MonthlyReportRecord } from "@/modules/finance/monthly-financial-report-query";
import type { MonthlyCardPurchase, MonthlyReportSnapshot, MonthlyStatement } from "@/modules/finance/monthly-financial-report";
import { assignCardTransactionResponsibility, closeFinancialMonth, prepareFinancialMonthForReview, reopenFinancialMonth, retryMonthlyReportPdf, saveOfficialStatement } from "@/app/financeiro/relatorios/actions";

const statusLabel: Record<string, string> = { open: "Em andamento", awaiting_consolidation: "Aguardando consolidação", review: "Pronto para revisão", closing: "Concluindo mês", closed: "Concluído", reopened: "Reaberto para correção" };
const date = (value: string) => new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" }).format(new Date(value));
const monthName = (year: number, month: number) => new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(year, month - 1, 1)));

export function MonthlyStatusBadge({ status }: { status: string }) { return <span className={`monthly-status-badge ${status}`}><i />{statusLabel[status] ?? status}</span>; }

export function MonthlyStatusBanner({ month }: { month: FinancialMonthRecord }) {
  const messages: Record<string, string> = {
    open: "Seu mês ainda está em andamento. Os valores serão atualizados durante o mês.",
    awaiting_consolidation: `${monthName(month.reference_year, month.reference_month)} terminou. Agora estamos reunindo as últimas informações dos cartões.`,
    review: "Tudo certo. Este mês já pode ser revisado e concluído.",
    closing: "Estamos salvando a fotografia deste mês e preparando o relatório.",
    closed: "Este é o fechamento oficial. Os valores salvos não mudarão automaticamente.",
    reopened: "O mês foi reaberto para correção. A versão anterior continua preservada.",
  };
  return <div className={`monthly-banner ${month.status}`}><span>{messages[month.status]}</span>{month.recommended_close_at && month.status === "awaiting_consolidation" ? <small>Conclusão recomendada após {date(month.recommended_close_at)}</small> : null}</div>;
}

export function MonthlySummaryCards({ snapshot, partial }: { snapshot: MonthlyReportSnapshot; partial: boolean }) {
  const cards = [["Saldo inicial", snapshot.totals.openingBalance], ["Entradas", snapshot.totals.totalIncome], ["Saídas bancárias", snapshot.totals.totalBankOutflows], ["Resultado em caixa", snapshot.totals.cashResult], ["Saldo final", snapshot.totals.closingBalance], ["Consumo pessoal", snapshot.totals.personalConsumption]] as const;
  return <section className="monthly-summary monthly-summary-panel">{cards.map(([label, value]) => <article key={label}><span>{label}</span><strong><Money value={value} /></strong>{partial ? <small>Parcial até hoje</small> : <small>Mês completo</small>}</article>)}</section>;
}

export function CardStatementReconciliation({ statement, common, editable = true }: { statement: MonthlyStatement; common: { workspaceId: string; year: number; month: number }; editable?: boolean }) {
  const difference = statement.official_total_amount == null ? null : statement.official_total_amount - statement.calculated_total_amount;
  return <article className="statement-card">
    <header><div><h3>{statement.card_name}</h3><small>Fecha em {date(statement.closing_date)} • vence em {date(statement.due_date)}</small></div><span className={Math.abs(difference ?? 0) < .01 ? "positive" : "negative"}>{statement.reconciliation_status === "matched" ? "Conferida" : "A conferir"}</span></header>
    <dl><div><dt>Calculado pelo Atlas</dt><dd><Money value={statement.calculated_total_amount} /></dd></div><div><dt>Valor oficial</dt><dd>{statement.official_total_amount == null ? "Não informado" : <Money value={statement.official_total_amount} />}</dd></div><div><dt>Diferença</dt><dd>{difference == null ? "—" : <Money value={difference} />}</dd></div></dl>
    {editable ? <details><summary>Informar ou atualizar valor oficial</summary><form action={saveOfficialStatement} className="monthly-inline-form">
      <input type="hidden" name="workspace_id" value={common.workspaceId} /><input type="hidden" name="invoice_id" value={statement.id} /><input type="hidden" name="year" value={common.year} /><input type="hidden" name="month" value={common.month} />
      <label>Valor oficial<input required name="official_amount" inputMode="decimal" defaultValue={statement.official_total_amount ?? ""} /></label>
      <label>Fechamento<input required type="date" name="closing_date" defaultValue={statement.closing_date.slice(0, 10)} /></label><label>Vencimento<input required type="date" name="due_date" defaultValue={statement.due_date.slice(0, 10)} /></label>
      <label>Início do ciclo<input type="date" name="cycle_start" defaultValue={statement.cycle_start_date?.slice(0, 10)} /></label><label>Fim do ciclo<input type="date" name="cycle_end" defaultValue={statement.cycle_end_date?.slice(0, 10)} /></label>
      <label className="wide">Observação<textarea name="note" /></label><label className="monthly-check wide"><input type="checkbox" name="confirm_difference" /> Confirmo a diferença explicada acima</label><button className="finance-button">Salvar valor oficial</button>
    </form></details> : null}
    {editable ? <Link href={`/financeiro/cartoes/importar-fatura?workspace=${common.workspaceId}`} prefetch={false}>Enviar PDF da fatura</Link> : null}
  </article>;
}

export function MonthlyNarrative({ snapshot }: { snapshot: MonthlyReportSnapshot }) {
  if (!snapshot.narrative?.length) return null;
  return <section className="finance-panel monthly-narrative"><header><div><p className="eyebrow">Leitura do Atlas</p><h2>Como foi este mês</h2></div></header><div>{snapshot.narrative.map((message) => <p key={message}>{message}</p>)}</div></section>;
}

function Perspective({ title, eyebrow, perspective }: { title: string; eyebrow: string; perspective: NonNullable<MonthlyReportSnapshot["incomePerspective"]> }) {
  const differenceTone = perspective.absoluteDifference != null && perspective.absoluteDifference >= 0 ? "positive" : "negative";
  return <section className="finance-panel monthly-perspective"><header><div><p className="eyebrow">{eyebrow}</p><h2>{title}</h2></div></header><div className="monthly-perspective-values"><span>Este mês<strong><Money value={perspective.current} /></strong></span><span>{perspective.referenceLabel}<strong>{perspective.reference == null ? "Ainda sem referência" : <Money value={perspective.reference} />}</strong></span>{perspective.absoluteDifference != null ? <span className="monthly-perspective-difference"><em>Diferença</em><strong className={differenceTone}><Money value={perspective.absoluteDifference} /></strong>{perspective.percentageDifference == null ? null : <small className={differenceTone}>{perspective.percentageDifference > 0 ? "+" : ""}{perspective.percentageDifference}%</small>}</span> : null}</div><p>{perspective.message}</p></section>;
}

export function MonthlyPerspectiveSections({ snapshot }: { snapshot: MonthlyReportSnapshot }) {
  if (!snapshot.incomePerspective && !snapshot.cardPerspective) return null;
  return <div className="monthly-two-columns">{snapshot.incomePerspective ? <Perspective eyebrow="Renda em perspectiva" title="Receitas reais" perspective={snapshot.incomePerspective} /> : null}{snapshot.cardPerspective ? <Perspective eyebrow="Cartão em perspectiva" title="Fatura do cartão no mês" perspective={snapshot.cardPerspective} /> : null}</div>;
}

export function MonthlyCashFlowSection({ snapshot, workspaceId }: { snapshot: MonthlyReportSnapshot; workspaceId: string }) {
  const cashFlow = snapshot.cashFlow ?? [];
  const highlights = snapshot.highlights;
  return <div className="monthly-report-flow"><section className="finance-panel monthly-flow-panel"><header><div><p className="eyebrow">Fluxo financeiro</p><h2>Entradas, saídas e saldo</h2><small>Movimentações bancárias realizadas no período.</small></div></header>{cashFlow.length ? <AccountMovementChart data={cashFlow} openingBalance={snapshot.totals.openingBalance} /> : <div className="monthly-empty"><b>Ainda não há movimentações neste período.</b><span>Assim que houver entradas ou saídas, o fluxo do mês aparecerá aqui.</span></div>}</section>{highlights ? <section className="finance-panel monthly-highlights"><header><div><p className="eyebrow">Resumo do movimento</p><h2>Destaques do mês</h2></div></header><dl><div><dt>Maior entrada na conta</dt><dd><Money value={highlights.largestInflow} /></dd></div>{highlights.largestRealIncome > 0 && highlights.largestRealIncome !== highlights.largestInflow ? <div><dt>Maior receita real</dt><dd><Money value={highlights.largestRealIncome} /></dd></div> : null}<div><dt>Maior saída</dt><dd><Money value={highlights.largestOutflow} /></dd></div><div><dt>Movimentações bancárias</dt><dd>{highlights.movementCount}</dd></div></dl><Link href={`/financeiro/movimentacoes?workspace=${workspaceId}&month=${snapshot.period.key}`} prefetch={false}>Ver todos os lançamentos →</Link></section> : null}</div>;
}

export function PersonalConsumptionSection({ snapshot }: { snapshot: MonthlyReportSnapshot }) {
  const categories = snapshot.consumptionCategories ?? [];
  return <section className="finance-panel monthly-consumption"><header><div><p className="eyebrow">Consumo pessoal</p><h2>O que pertence a este mês</h2></div><strong><Money value={snapshot.totals.personalConsumption} /></strong></header><div className="monthly-consumption-split"><span>Pago diretamente em conta<strong><Money value={Math.max(0, snapshot.totals.personalConsumption - (snapshot.totals.personalCardConsumption ?? 0))} /></strong></span><span>Consumido no cartão<strong><Money value={snapshot.totals.personalCardConsumption ?? Math.max(0, snapshot.totals.totalCardConsumption - snapshot.totals.thirdPartyCardConsumption)} /></strong></span></div>{categories.length ? <div className="monthly-category-list">{categories.slice(0, 5).map((category) => <div key={category.name}><span>{category.name}<small>{category.share.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%</small></span><strong><Money value={category.amount} /></strong></div>)}</div> : <p>Nenhuma despesa pessoal classificada neste período.</p>}</section>;
}

export function MonthlyFutureAndLoans({ snapshot }: { snapshot: MonthlyReportSnapshot }) {
  const commitments = snapshot.futureCommitments ?? [];
  const loans = snapshot.loans ?? [];
  if (!commitments.length && !loans.length) return null;
  return <div className="monthly-two-columns">{commitments.length ? <section className="finance-panel"><header><div><p className="eyebrow">Próximos meses</p><h2>Compromissos futuros</h2></div></header><div className="finance-list">{commitments.map((item) => <div key={item.month}><span>{new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${item.month}-01T12:00:00Z`))}</span><strong><Money value={item.amount} /></strong></div>)}</div><p>Nos próximos 90 dias, já existem <Money value={snapshot.totals.futureCommitments90d ?? commitments.reduce((sum, item) => sum + item.amount, 0)} /> comprometidos.</p></section> : null}{loans.length ? <section className="finance-panel"><header><div><p className="eyebrow">Dívidas</p><h2>Empréstimos e financiamentos</h2></div></header><div className="monthly-loan-list">{loans.map((loan) => <article key={loan.id}><span><b>{loan.name}</b><small>{loan.institution ?? "Instituição não informada"}{loan.payrollDeducted ? " • descontado em folha" : ""}</small></span><span><strong><Money value={loan.outstandingBalance} /></strong><small>Parcela <Money value={loan.installmentAmount} />{loan.remainingInstallments == null ? "" : ` • ${loan.remainingInstallments} restantes`}</small></span></article>)}</div></section> : null}</div>;
}

export function MonthlyTransactionsSection({ snapshot }: { snapshot: MonthlyReportSnapshot }) {
  if (!snapshot.entries.length) return null;
  return <details className="finance-panel monthly-transactions"><summary>Movimentações do período <span>{snapshot.entries.length}</span></summary><div className="monthly-transaction-list">{snapshot.entries.slice(0, 100).map((entry) => <div key={`${entry.source}:${entry.id}`}><time>{date(entry.date)}</time><span><b>{entry.description}</b><small>{entry.context} • {entry.category} • {entry.origin}</small></span><strong className={entry.kind === "revenue" ? "positive" : "negative"}><Money value={entry.kind === "revenue" ? entry.amount : -entry.amount} /></strong></div>)}</div>{snapshot.entries.length > 100 ? <p>Mostrando as 100 movimentações mais relevantes. Use a página de movimentações para consultar todas.</p> : null}</details>;
}

export function MonthlyAttentionList({ snapshot }: { snapshot: MonthlyReportSnapshot }) {
  return <section className="finance-panel monthly-attention"><header><div><p className="eyebrow">Antes de concluir</p><h2>Atenção</h2></div><strong>{snapshot.issues.filter((item) => item.severity === "blocking").length} bloqueios</strong></header>{snapshot.issues.length ? <div>{snapshot.issues.map((issue) => <article key={issue.key} className={issue.severity}><i>{issue.severity === "blocking" ? "!" : "i"}</i><span><b>{issue.title}</b><small>{issue.description}</small></span>{issue.amount ? <Money value={issue.amount} /> : null}</article>)}</div> : <p>Tudo certo para concluir este mês.</p>}</section>;
}

export function ResponsibilityDistribution({ purchases, people, common }: { purchases: MonthlyCardPurchase[]; people: Array<{ id: string; name: string }>; common: { workspaceId: string; year: number; month: number } }) {
  const unresolved = purchases.filter((item) => !item.responsibility_confirmed || item.responsibility_type === "uncertain");
  const ownCount = purchases.filter((item) => item.responsibility_type === "own_expense").length;
  const peopleById = new Map(people.map((person) => [person.id, person.name]));
  const assignedCounts = purchases.reduce((counts, purchase) => {
    if (purchase.responsibility_type === "own_expense" || !purchase.financial_responsible_id) return counts;
    counts.set(purchase.financial_responsible_id, (counts.get(purchase.financial_responsible_id) ?? 0) + 1);
    return counts;
  }, new Map<string, number>());
  return <section className="finance-panel"><header><div><p className="eyebrow">Quem paga cada parte</p><h2>Compras a confirmar</h2></div><strong>{unresolved.length}</strong></header>{unresolved.length ? <div className="monthly-purchase-list">{unresolved.map((purchase) => <details key={purchase.id}><summary><span>{purchase.description}</span><Money value={Number(purchase.installment_amount ?? purchase.total_amount)} /></summary><form action={assignCardTransactionResponsibility} className="monthly-inline-form">
    <input type="hidden" name="workspace_id" value={common.workspaceId} /><input type="hidden" name="purchase_id" value={purchase.id} /><input type="hidden" name="year" value={common.year} /><input type="hidden" name="month" value={common.month} />
    <label>Responsabilidade<select name="responsibility_type" defaultValue="own_expense"><option value="own_expense">Minha despesa</option><option value="third_party_expense">Despesa de outra pessoa</option><option value="shared_expense">Despesa compartilhada</option><option value="business_reimbursable">Despesa a reembolsar</option></select></label>
    <label>Quem pagará<select name="financial_responsible_id"><option value="">Eu</option>{people.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label><label>Minha parte<input name="personal_share" inputMode="decimal" /></label><label className="wide">Observação<input name="note" /></label><button className="finance-button">Confirmar</button>
  </form></details>)}</div> : <div className="monthly-responsibility-summary"><p>Todas as compras possuem responsável.</p>{ownCount ? <span><i aria-hidden="true" />{ownCount} {ownCount === 1 ? "compra considerada sua" : "compras consideradas suas"} por padrão</span> : null}{[...assignedCounts].map(([personId, count]) => <span key={personId}><i aria-hidden="true" />{count} {count === 1 ? "compra atribuída" : "compras atribuídas"} a {peopleById.get(personId) ?? "outra pessoa"} conforme o cartão</span>)}</div>}</section>;
}

export function MonthlyReportVersionHistory({ versions, common }: { versions: MonthlyReportRecord[]; common: { workspaceId: string; year: number; month: number } }) {
  return <section className="finance-panel"><header><div><p className="eyebrow">Histórico preservado</p><h2>Versões</h2></div></header><div className="finance-list">{versions.map((version) => <div key={version.id}><span><b>Versão {version.version}</b><small>{date(version.generated_at)} • {version.status === "superseded" ? "Substituída" : version.status === "final" ? "Versão atual" : "PDF pendente"}</small></span><span>{version.pdf_storage_path ? <Link href={`/api/monthly-reports/${version.id}/pdf`} prefetch={false}>Abrir PDF</Link> : version.status === "generation_failed" ? <form action={retryMonthlyReportPdf}><input type="hidden" name="workspace_id" value={common.workspaceId} /><input type="hidden" name="report_id" value={version.id} /><input type="hidden" name="year" value={common.year} /><input type="hidden" name="month" value={common.month} /><button className="finance-button secondary">Gerar PDF novamente</button></form> : "Preparando"}</span></div>)}</div></section>;
}

export function MonthlyCloseDialog({ month, snapshot, canAdmin, common }: { month: FinancialMonthRecord; snapshot: MonthlyReportSnapshot; canAdmin: boolean; common: { workspaceId: string; year: number; month: number } }) {
  const blockers = snapshot.issues.filter((issue) => issue.severity === "blocking");
  if (!canAdmin) return null;
  if (month.status === "closed") return <details className="monthly-close-box"><summary>Reabrir mês</summary><form action={reopenFinancialMonth}><input type="hidden" name="workspace_id" value={common.workspaceId} /><input type="hidden" name="month_id" value={month.id} /><input type="hidden" name="year" value={common.year} /><input type="hidden" name="month" value={common.month} /><label>Motivo<textarea required minLength={3} name="reason" /></label><button className="finance-button secondary">Confirmar reabertura</button></form></details>;
  if (["awaiting_consolidation", "reopened"].includes(month.status) && !blockers.length) return <details className="monthly-close-box" open><summary>Tudo certo para revisar este mês</summary><form action={prepareFinancialMonthForReview}><input type="hidden" name="workspace_id" value={common.workspaceId} /><input type="hidden" name="year" value={common.year} /><input type="hidden" name="month" value={common.month} /><p>As faturas, responsabilidades e diferenças estão conferidas. Avance para a revisão final.</p><button className="finance-button">Preparar revisão</button></form></details>;
  return <details className="monthly-close-box" open={!blockers.length && month.status !== "open"}><summary>{blockers.length ? `Ainda há ${blockers.length} item(ns) para conferir` : `Concluir ${monthName(common.year, common.month)} e gerar relatório`}</summary>{blockers.length ? <p>Resolva os itens marcados como necessários antes de continuar.</p> : <form action={closeFinancialMonth}><input type="hidden" name="workspace_id" value={common.workspaceId} /><input type="hidden" name="year" value={common.year} /><input type="hidden" name="month" value={common.month} /><p>O Atlas salvará uma fotografia deste mês. Alterações futuras exigirão reabertura e criarão uma nova versão.</p><button className="finance-button">Concluir e gerar relatório</button></form>}</details>;
}
