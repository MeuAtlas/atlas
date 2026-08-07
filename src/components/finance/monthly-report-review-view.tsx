import Link from "next/link";

import {
  assignCardTransactionResponsibility,
  confirmStatementPayment,
  linkStatementPayment,
  reopenFinancialMonth,
} from "@/app/financeiro/relatorios/actions";
import type { MonthlyReportReviewViewModel } from "@/modules/finance/monthly-report-review";
import type { MonthlyReportSnapshot } from "@/modules/finance/monthly-financial-report";
import { AccountMovementChart } from "./overview-charts";
import { Money } from "./value-visibility";
import { MonthlyReportCloseDialog } from "./monthly-report-close-dialog";

const date = (value: string) => new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC",
}).format(new Date(`${value.slice(0, 10)}T12:00:00Z`));
const monthName = (value: string) => new Intl.DateTimeFormat("pt-BR", {
  month: "long", year: "numeric", timeZone: "UTC",
}).format(new Date(`${value}-01T12:00:00Z`));

export function MonthlyReportStatus({ status, label }: {
  status: string;
  label: string;
}) {
  return <span className={`monthly-status-badge ${status}`}><i />{label}</span>;
}

export function MonthlyReportHeader({ view, backUrl, previewPdfUrl, finalPdfUrl }: {
  view: MonthlyReportReviewViewModel;
  backUrl: string;
  previewPdfUrl: string;
  finalPdfUrl?: string | null;
}) {
  const target = view.blockingIssues.length ? "#monthly-blocking-issues" : "#monthly-final-review";
  return <header className="monthly-review-header">
    <div className="monthly-review-header-copy">
      <Link href={backUrl} prefetch={false}>← Todos os meses</Link>
      <p className="eyebrow">Relatório mensal</p>
      <div className="monthly-review-title-line">
        <h1 className="capitalize">{view.header.monthLabel}</h1>
        <MonthlyReportStatus status={view.header.status} label={view.header.statusLabel} />
      </div>
      <div className="monthly-review-meta">
        <span>Período considerado: {view.header.periodLabel}</span>
        <span>Última atualização: {new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(view.header.lastUpdatedAt))}</span>
      </div>
    </div>
    <div className="monthly-review-header-actions">
      {finalPdfUrl ? <a className="finance-button secondary" href={finalPdfUrl} target="_blank" rel="noreferrer">Ver relatório</a> : <details className="monthly-preview-menu"><summary>Ver prévia do PDF</summary><div><a href={previewPdfUrl} target="_blank" rel="noreferrer">Abrir prévia</a><a href={`${previewPdfUrl}&download=1`}>Baixar prévia</a></div></details>}
      {view.header.status !== "closed" ? <a className="finance-button" href={target}>{view.blockingIssues.length ? "Resolver pendência" : "Revisar e concluir"}</a> : null}
    </div>
  </header>;
}

export function MonthlyReportNotice({ view }: { view: MonthlyReportReviewViewModel }) {
  return <div className={`monthly-review-notice ${view.blockingIssues.length ? "warning" : "ready"}`}>
    <span>{view.notice}</span>
    {view.firstMonth ? <small>Este é o primeiro mês acompanhado pelo Atlas.</small> : null}
  </div>;
}

export function MonthlyBlockingIssueCard({ issue, common }: {
  issue: MonthlyReportReviewViewModel["blockingIssues"][number];
  common: { workspaceId: string; year: number; month: number };
}) {
  if (issue.type === "unmatched_card_payment" && issue.statement && issue.candidate) {
    return <article className="monthly-blocking-card">
      <div className="monthly-blocking-copy">
        <span className="monthly-blocking-kicker">Pagamento encontrado</span>
        <h3>{issue.title}</h3>
        <p>{issue.description}</p>
      </div>
      <dl className="monthly-blocking-facts">
        <div><dt>Fatura</dt><dd>{issue.statement.card_name}</dd></div>
        <div><dt>Valor esperado</dt><dd><Money value={issue.statement.expected_statement_amount} /></dd></div>
        <div><dt>Pagamento encontrado</dt><dd><Money value={issue.candidate.amount} /></dd></div>
        <div><dt>Data</dt><dd>{date(issue.candidate.paymentDate)}</dd></div>
      </dl>
      <div className="monthly-blocking-actions">
        <form action={linkStatementPayment}>
          <input type="hidden" name="workspace_id" value={common.workspaceId} />
          <input type="hidden" name="statement_id" value={issue.statement.id} />
          <input type="hidden" name="transaction_id" value={issue.candidate.id} />
          <input type="hidden" name="allocated_amount" value={issue.candidate.amount} />
          <input type="hidden" name="year" value={common.year} />
          <input type="hidden" name="month" value={common.month} />
          <button className="finance-button" type="submit">Confirmar vínculo</button>
        </form>
        <details className="monthly-alternative-actions">
          <summary>Outras opções</summary>
          <div>
            <form action={linkStatementPayment} className="monthly-inline-form">
              <input type="hidden" name="workspace_id" value={common.workspaceId} />
              <input type="hidden" name="statement_id" value={issue.statement.id} />
              <input type="hidden" name="year" value={common.year} />
              <input type="hidden" name="month" value={common.month} />
              <label className="wide">Vincular outro pagamento<input required name="transaction_id" placeholder="ID da movimentação bancária" /></label>
              <label>Valor a considerar<input name="allocated_amount" inputMode="decimal" /></label>
              <button className="finance-button secondary" type="submit">Vincular</button>
            </form>
            <form action={confirmStatementPayment} className="monthly-inline-form">
              <input type="hidden" name="workspace_id" value={common.workspaceId} />
              <input type="hidden" name="statement_id" value={issue.statement.id} />
              <input type="hidden" name="year" value={common.year} />
              <input type="hidden" name="month" value={common.month} />
              <label>Valor confirmado<input required name="amount" inputMode="decimal" /></label>
              <label>Data<input required type="date" name="payment_date" /></label>
              <label className="monthly-check wide"><input type="checkbox" name="direct_third_party" /> Pagamento direto por terceiro</label>
              <button className="finance-button secondary" type="submit">Confirmar sem movimentação</button>
            </form>
            <p>Para dividir ou tratar um pagamento parcial, vincule somente o valor correspondente e repita a operação para os demais pagamentos.</p>
          </div>
        </details>
      </div>
    </article>;
  }
  return <article className="monthly-blocking-card compact">
    <div><h3>{issue.title}</h3><p>{issue.description}</p></div>
    {issue.amount != null ? <strong><Money value={issue.amount} /></strong> : null}
  </article>;
}

export function MonthlyBlockingIssues({ view, common }: {
  view: MonthlyReportReviewViewModel;
  common: { workspaceId: string; year: number; month: number };
}) {
  return <section className={`monthly-review-section monthly-blocking-section ${view.blockingIssues.length ? "has-blockers" : "ready"}`} id="monthly-blocking-issues">
    <header><div><p className="eyebrow">Antes de concluir</p><h2>{view.blockingIssues.length ? `${view.blockingIssues.length} ${view.blockingIssues.length === 1 ? "pendência precisa" : "pendências precisam"} da sua confirmação` : "Tudo pronto para a revisão final"}</h2></div></header>
    {view.blockingIssues.length ? <div className="monthly-blocking-list">{view.blockingIssues.map(issue => <MonthlyBlockingIssueCard key={issue.id} issue={issue} common={common} />)}</div> : <p className="monthly-ready-copy">Os dados essenciais estão conferidos. Avisos e itens opcionais aparecem no checklist final.</p>}
  </section>;
}

export function MonthlySummaryGrid({ view }: { view: MonthlyReportReviewViewModel }) {
  return <section className="monthly-review-section monthly-summary-section"><header><div><p className="eyebrow">Resumo do mês</p><h2>O mês em seis números</h2></div></header><div className="monthly-review-summary-grid">{view.summary.map(item => <article key={item.key} className={item.tone}><span>{item.label}</span><strong><Money value={item.value} /></strong><small>{item.helper}</small></article>)}</div></section>;
}

export function MonthlyAtlasReading({ view }: { view: MonthlyReportReviewViewModel }) {
  return <section className="monthly-review-section monthly-atlas-reading"><header><div><p className="eyebrow">Leitura do Atlas</p><h2>Como foi este mês</h2></div></header><div>{view.narrative.map(message => <p key={message}>{message}</p>)}</div></section>;
}

export function MonthlyCashFlowHighlights({ view }: { view: MonthlyReportReviewViewModel }) {
  return <div className="monthly-cash-highlights">{view.cashFlow.highlights.map(item => <article key={item.label}><span>{item.label}</span><strong>{item.count ? item.value.toLocaleString("pt-BR") : <Money value={item.value} />}</strong>{item.description ? <small>{item.description}</small> : null}</article>)}</div>;
}

export function MonthlyCashFlowReviewSection({ view, snapshot, workspaceId }: {
  view: MonthlyReportReviewViewModel;
  snapshot: MonthlyReportSnapshot;
  workspaceId: string;
}) {
  return <section className="monthly-review-section monthly-review-cash-flow"><header><div><p className="eyebrow">Fluxo financeiro</p><h2>Entradas, saídas e saldo</h2><small>Movimentações bancárias realizadas em {view.header.shortMonthLabel}.</small></div></header>{view.cashFlow.series.length ? <AccountMovementChart data={view.cashFlow.series} openingBalance={snapshot.totals.openingBalance} /> : <MonthlyEmptyState title="Ainda não há movimentações neste período." />}
    <MonthlyCashFlowHighlights view={view} />
    <div className="monthly-balance-line">{snapshot.accounts.length === 1 ? <><span>Saldo final no {snapshot.accounts[0].name}</span><strong><Money value={snapshot.totals.closingBalance} /></strong></> : <details><summary>Ver saldos por conta</summary><div>{snapshot.accounts.map(account => <span key={account.id}>{account.name}<strong><Money value={account.closingBalance} /></strong></span>)}</div></details>}<Link href={`/financeiro/movimentacoes?workspace=${workspaceId}&month=${snapshot.period.key}`} prefetch={false}>Ver todos os lançamentos</Link></div>
  </section>;
}

export function MonthlyIncomeSection({ view, movementsUrl }: { view: MonthlyReportReviewViewModel; movementsUrl: string }) {
  const income = view.income;
  return <section className="monthly-review-section monthly-review-income"><header><div><p className="eyebrow">Sua renda</p><h2>O que entrou como renda real</h2></div></header><div className="monthly-income-summary"><span>Recebido em {view.header.shortMonthLabel}<strong><Money value={income.received} /></strong></span>{income.reference == null ? <div className="monthly-comparison-empty"><b>Primeiro mês acompanhado</b><p>A comparação aparecerá após os próximos fechamentos.</p></div> : <><span>Referência recente<strong><Money value={income.reference} /></strong></span><span>Diferença<strong className={(income.difference ?? 0) < 0 ? "negative" : "positive"}><Money value={income.difference ?? 0} /></strong><small>{Math.abs(income.percentage ?? 0).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}% {(income.difference ?? 0) < 0 ? "abaixo" : "acima"}</small></span></>}</div>
    {income.needsClassification ? <div className="monthly-classification-notice"><p>A renda deste mês ainda precisa ser classificada entre salário, diárias, adicionais e outras fontes.</p><Link href={movementsUrl} prefetch={false}>Revisar composição da renda</Link></div> : income.items.length ? <div className="monthly-compact-list">{income.items.map(item => <span key={item.name}>{item.name}<strong><Money value={item.amount} /></strong></span>)}</div> : null}
  </section>;
}

export function MonthlyConsumptionSection({ view, movementsUrl }: { view: MonthlyReportReviewViewModel; movementsUrl: string }) {
  const consumption = view.consumption;
  return <section className="monthly-review-section monthly-review-consumption"><header><div><p className="eyebrow">Para onde foi o dinheiro</p><h2>Consumo identificado no mês</h2></div></header><div className="monthly-consumption-totals"><span>Pago diretamente pela conta<strong><Money value={consumption.direct} /></strong></span><span>Compras realizadas no cartão<strong><Money value={consumption.card} /></strong></span><span>Total de consumo identificado<strong><Money value={consumption.total} /></strong></span></div>
    {consumption.needsClassification ? <div className="monthly-classification-notice warning"><p>As despesas deste mês ainda não foram classificadas.</p><small>{consumption.uncategorizedCount} movimentações precisam de categoria para o Atlas explicar corretamente para onde foi o dinheiro.</small><Link href={movementsUrl} prefetch={false}>Revisar categorias</Link></div> : <div className="monthly-compact-list">{consumption.categories.map(item => <span key={item.name}>{item.name}<strong><Money value={item.amount} /></strong></span>)}</div>}
  </section>;
}

export function MonthlyCommitmentsSection({ view, movementsUrl }: { view: MonthlyReportReviewViewModel; movementsUrl: string }) {
  const commitments = view.commitments;
  return <section className="monthly-review-section monthly-review-commitments"><header><div><p className="eyebrow">Compromissos do mês</p><h2>O que já estava comprometido</h2></div><span>{commitments.incomeShare == null ? "Sem proporção disponível" : `${commitments.incomeShare.toLocaleString("pt-BR")}% da renda real`}</span></header><div className="monthly-commitment-grid"><article><span>Contas recorrentes</span><strong><Money value={commitments.recurring} /></strong></article><article><span>Casa</span>{commitments.householdUnclassified ? <strong className="muted">Não classificado</strong> : commitments.household ? <strong><Money value={commitments.household} /></strong> : <strong className="muted">Nenhuma despesa neste mês</strong>}</article><article><span>Filhas</span><strong><Money value={commitments.dependents} /></strong></article><article className="total"><span>Total identificado</span><strong><Money value={commitments.total} /></strong></article></div>
    {commitments.householdUnclassified ? <div className="monthly-inline-notice"><span>Nenhuma despesa da casa foi classificada.</span><Link href={movementsUrl} prefetch={false}>Revisar custos da casa</Link></div> : null}
    {commitments.dependentPeople.length ? <div className="monthly-compact-list dependents">{commitments.dependentPeople.map(person => <span key={person.name}>{person.name}<strong><Money value={person.total} /></strong></span>)}</div> : null}
    <div className="monthly-available-inline"><span>Disponível antes dos gastos variáveis<small>Renda real menos contas recorrentes, casa e dependentes.</small></span><strong className={commitments.available < 0 ? "negative" : "positive"}><Money value={commitments.available} /></strong>{commitments.partial ? <em>Estimativa parcial</em> : null}</div>
  </section>;
}

export function MonthlyPaidCardSection({ view, invoiceUploadUrl }: {
  view: MonthlyReportReviewViewModel;
  invoiceUploadUrl: string;
}) {
  return <section className="monthly-review-section monthly-paid-card-section"><header><div><p className="eyebrow">Cartão pago em {view.header.shortMonthLabel}</p><h2>Pagamento que saiu da conta</h2></div></header>{view.paidStatements.length ? <div className="monthly-paid-card-list">{view.paidStatements.map(statement => <article key={statement.id}><header><div><h3>{statement.card_name}</h3><small>Pagamento confirmado pela movimentação da conta.</small></div><span className={statement.state === "confirmed" ? "positive" : "warning"}>{statement.state === "confirmed" ? "Pago" : statement.state === "partial" ? "Pagamento parcial" : "Diferença encontrada"}</span></header><dl><div><dt>Valor pago</dt><dd><Money value={statement.confirmed_payment_amount} /></dd></div><div><dt>Data do pagamento</dt><dd>{statement.payments[0] ? date(statement.payments[0].paymentDate) : "Não informada"}</dd></div><div><dt>Conta utilizada</dt><dd>{statement.payments[0]?.accountName ?? "Conta não informada"}</dd></div><div><dt>Sua parte</dt><dd><Money value={statement.personal_share_amount} /></dd></div><div><dt>Parte de terceiros</dt><dd><Money value={statement.third_party_share_amount} /></dd></div><div><dt>Custo líquido pessoal</dt><dd><Money value={statement.netPersonalCost} /></dd></div></dl><details><summary>Ver detalhes da conciliação</summary><p>Valor esperado: <Money value={statement.expected_statement_amount} />. O PDF é opcional e serve apenas para detalhamento.</p></details></article>)}</div> : view.detectedStatements.length ? <div className="monthly-detected-card">{view.detectedStatements.map(item => <article key={item.statement.id}><span><b>{item.statement.card_name}</b><small>Pagamento encontrado · aguardando confirmação</small></span><strong><Money value={item.candidate?.amount ?? item.statement.expected_statement_amount} /></strong></article>)}</div> : <MonthlyEmptyState title="Nenhum pagamento de fatura foi identificado neste mês." />}
    <div className="monthly-card-secondary"><span>{view.reimbursements.pending || view.reimbursements.received ? <>Reembolsos: <Money value={view.reimbursements.received} /> recebidos · <Money value={view.reimbursements.pending} /> pendentes</> : "Não há valores de terceiros neste mês."}</span><Link href={invoiceUploadUrl} prefetch={false}>Anexar PDF da fatura — opcional</Link></div>
    {view.reimbursements.people.length ? <details className="monthly-reimbursement-details"><summary>Ver valores por pessoa</summary><div className="monthly-compact-list">{view.reimbursements.people.map(person => <span key={person.personId ?? person.personName}>{person.personName}<small><Money value={person.received} /> recebidos · <Money value={person.pending} /> pendentes</small><strong><Money value={person.total} /></strong></span>)}</div></details> : null}
  </section>;
}

export function MonthlyNextStatementSection({ view }: { view: MonthlyReportReviewViewModel }) {
  if (!view.openStatements.length) return null;
  const statementMonth = view.openStatements[0].due_date.slice(0, 7);
  return <section className="monthly-review-section monthly-next-statement-section"><header><div><p className="eyebrow">Fatura de {monthName(statementMonth)}</p><h2>Compromisso do mês seguinte</h2></div></header><div className="monthly-next-statement-list">{view.openStatements.map(statement => {
    const official = statement.official_amount_confirmed || Boolean(statement.pdf_document_id);
    const expectedAmount = statement.official_total_amount ?? statement.expected_statement_amount;
    const settled = statement.payment_confirmation_status === "paid" ||
      (expectedAmount > 0 && statement.confirmed_payment_amount >= expectedAmount);
    return <article key={statement.id}><header><div><h3>{statement.card_name}</h3><small>{settled ? "Paga antecipadamente" : official ? "Valor oficial confirmado" : "Aberta"}</small></div><strong><Money value={official && statement.official_total_amount !== null ? statement.official_total_amount : statement.current_open_amount} /></strong></header><dl><div><dt>{settled ? "Valor já pago" : official ? "Sua parte confirmada" : "Sua parte estimada"}</dt><dd><Money value={statement.personal_share_amount} /></dd></div><div><dt>Parte de terceiros</dt><dd><Money value={statement.third_party_share_amount} /></dd></div><div><dt>Fecha em</dt><dd>{date(statement.closing_date)}</dd></div><div><dt>Vence em</dt><dd>{date(statement.due_date)}</dd></div></dl>{settled ? null : statement.incomeCommitmentPercentage == null ? null : <div className="monthly-income-commitment"><span>Sua renda estimada comprometida pelo cartão</span><strong>{statement.incomeCommitmentPercentage.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%</strong><small>A sua parte atual da fatura compromete aproximadamente este percentual da renda esperada. {statement.incomeEstimated ? "Percentual estimado com base na renda real mais recente." : ""}</small></div>}<p>{settled ? `Fatura oficial importada e já paga em ${view.header.shortMonthLabel}; não entra novamente no compromisso de agosto.` : official ? "Valor confirmado pela fatura importada. Ele compõe o compromisso do mês seguinte." : `Esta fatura ainda pode mudar até o fechamento. Ela não é uma saída de ${view.header.shortMonthLabel}.`}</p></article>;
  })}</div></section>;
}

export function MonthlyResponsiblePurchases({ view, people, common }: {
  view: MonthlyReportReviewViewModel;
  people: Array<{ id: string; name: string }>;
  common: { workspaceId: string; year: number; month: number };
}) {
  const responsible = view.responsiblePurchases;
  return <details className="monthly-review-section monthly-optional-section"><summary><span><b>Responsáveis das compras</b><small>{responsible.unresolved.length ? `${responsible.unresolved.length} compras precisam de responsável` : "Tudo confirmado"}</small></span><em>{responsible.unresolved.length ? "Precisa revisar" : "Confirmado"}</em></summary><div>{responsible.unresolved.length ? responsible.unresolved.map(purchase => <form action={assignCardTransactionResponsibility} className="monthly-responsibility-form" key={purchase.id}><input type="hidden" name="workspace_id" value={common.workspaceId} /><input type="hidden" name="purchase_id" value={purchase.id} /><input type="hidden" name="year" value={common.year} /><input type="hidden" name="month" value={common.month} /><strong>{purchase.description}</strong><label>Responsabilidade<select name="responsibility_type" defaultValue="own_expense"><option value="own_expense">Minha despesa</option><option value="third_party_expense">Despesa de outra pessoa</option><option value="shared_expense">Despesa compartilhada</option><option value="business_reimbursable">Despesa a reembolsar</option></select></label><label>Quem pagará<select name="financial_responsible_id"><option value="">Eu</option>{people.map(person => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label><button className="finance-button secondary" type="submit">Confirmar</button></form>) : <div className="monthly-responsible-copy"><p>{responsible.ownCount} compras consideradas suas por padrão.</p>{[...responsible.assignedCounts].map(([personId, count]) => <p key={personId}>{count} compras atribuídas a {people.find(person => person.id === personId)?.name ?? "outra pessoa"} conforme o cartão adicional.</p>)}</div>}</div></details>;
}

export function MonthlyInstallmentsSection({ view }: { view: MonthlyReportReviewViewModel }) {
  const installments = view.installments;
  if (!installments?.items.length) return <div className="monthly-compact-empty">Nenhum parcelamento foi identificado.</div>;
  return <details className="monthly-review-section monthly-optional-section"><summary><span><b>Compras parceladas</b><small>{installments.items.length} parcelamentos identificados</small></span><em>Ver detalhes</em></summary><div><div className="monthly-installment-totals"><span>Parcelas nesta fatura<strong><Money value={installments.chargedNow} /></strong></span><span>Já pago<strong><Money value={installments.paid} /></strong></span><span>Ainda falta<strong><Money value={installments.remaining} /></strong></span></div><div className="monthly-compact-list">{installments.items.map(item => <span key={item.id}>{item.description}<small>Parcela {item.current} de {item.total} · termina em {item.endsAt.slice(0, 7).split("-").reverse().join("/")}</small><strong><Money value={item.amount} /></strong></span>)}</div></div></details>;
}

export function MonthlyFutureSection({ view }: { view: MonthlyReportReviewViewModel }) {
  const future = view.future;
  return <section className="monthly-review-section monthly-future-section"><header><div><p className="eyebrow">Próximos meses</p><h2>Compromissos já identificados</h2></div></header>{future.months.length ? <div className="monthly-future-months">{future.months.map(item => <article key={item.month}><header><h3>{monthName(item.month)}</h3><strong>{item.total ? <><Money value={item.total} /> comprometidos</> : "Nenhum compromisso identificado"}</strong></header>{item.total ? <dl>{item.card ? <div><dt>Fatura do cartão — sua parte</dt><dd><Money value={item.card} /></dd></div> : null}{item.recurring ? <div><dt>Contas recorrentes</dt><dd><Money value={item.recurring} /></dd></div> : null}{item.other ? <div><dt>Outros previstos</dt><dd><Money value={item.other} /></dd></div> : null}</dl> : null}</article>)}</div> : <MonthlyEmptyState title="Nenhum compromisso futuro foi identificado." />}
    <div className="monthly-future-summary"><span>Saldo final de {view.header.shortMonthLabel}<strong><Money value={future.closingBalance} /></strong></span><span>Compromissos do próximo mês<strong><Money value={future.nextCommitments} /></strong></span><span>Diferença<strong className={future.difference < 0 ? "negative" : "positive"}><Money value={future.difference} /></strong></span><span>A receber de terceiros<strong><Money value={future.reimbursementsPending} /></strong></span></div>{future.difference < 0 ? <p>O próximo mês começa com compromissos acima do saldo final de {view.header.shortMonthLabel}.</p> : null}
  </section>;
}

export function MonthlyLoansSection({ snapshot }: { snapshot: MonthlyReportSnapshot }) {
  const loans = snapshot.loans ?? [];
  if (!loans.length) return null;
  return <details className="monthly-review-section monthly-optional-section"><summary><span><b>Empréstimos e financiamentos</b><small>{loans.length} {loans.length === 1 ? "contrato identificado" : "contratos identificados"}</small></span><em>Ver detalhes</em></summary><div className="monthly-loan-list">{loans.map(loan => <article key={loan.id}><span><b>{loan.name}</b><small>{loan.institution ?? "Instituição não informada"}{loan.payrollDeducted ? " · descontado em folha" : ""}</small></span><span><strong><Money value={loan.outstandingBalance} /></strong><small>Parcela <Money value={loan.installmentAmount} />{loan.remainingInstallments == null ? "" : ` · ${loan.remainingInstallments} restantes`}</small></span></article>)}</div></details>;
}

export function MonthlyFinalReview({ view }: { view: MonthlyReportReviewViewModel }) {
  return <section className="monthly-review-section monthly-final-review" id="monthly-final-review"><header><div><p className="eyebrow">Revisão final</p><h2>Checklist para conclusão</h2></div></header><div>{view.finalReview.map(item => <span key={item.label}><b>{item.label}</b><em className={item.tone}>{item.value}</em></span>)}</div>{view.warnings.length ? <details className="monthly-review-warnings"><summary>{view.warnings.length} avisos que não bloqueiam</summary><div>{view.warnings.map(warning => <article key={warning.id}><b>{warning.title}</b><p>{warning.description}</p><small>{warning.status === "optional" ? "Opcional" : "Não bloqueia"}</small></article>)}</div></details> : null}</section>;
}

export function MonthlyCloseSection({ view, snapshot, common, monthId, canAdmin }: {
  view: MonthlyReportReviewViewModel;
  snapshot: MonthlyReportSnapshot;
  common: { workspaceId: string; year: number; month: number };
  monthId: string;
  canAdmin: boolean;
}) {
  if (!canAdmin) return null;
  if (view.header.status === "closed") return <details className="monthly-conclusion closed"><summary>Reabrir {view.header.shortMonthLabel}</summary><form action={reopenFinancialMonth}><input type="hidden" name="workspace_id" value={common.workspaceId} /><input type="hidden" name="month_id" value={monthId} /><input type="hidden" name="year" value={common.year} /><input type="hidden" name="month" value={common.month} /><label>Motivo da reabertura<textarea required minLength={3} maxLength={1000} name="reason" /></label><button className="finance-button secondary" type="submit">Confirmar reabertura</button></form></details>;
  return <section className={`monthly-conclusion ${view.blockingIssues.length ? "blocked" : "ready"}`}><div><h2>{view.blockingIssues.length ? "Ainda não é possível concluir" : `${view.header.shortMonthLabel} está pronto`}</h2><p>{view.blockingIssues.length ? `Resolva ${view.blockingIssues.length} ${view.blockingIssues.length === 1 ? "pendência" : "pendências"} para concluir ${view.header.shortMonthLabel}.` : "O snapshot e o PDF final serão gerados após sua confirmação."}</p></div>{view.blockingIssues.length ? <><a className="finance-button" href="#monthly-blocking-issues">Resolver pendência</a><button className="finance-button secondary" disabled>Concluir {view.header.shortMonthLabel}</button></> : <MonthlyReportCloseDialog workspaceId={common.workspaceId} year={common.year} month={common.month} monthLabel={view.header.shortMonthLabel} result={snapshot.totals.cashResult} closingBalance={snapshot.totals.closingBalance} paidCard={snapshot.cashCardOutflow ?? 0} nextVersion={(view.versions.at(-1)?.version ?? 0) + 1} />}</section>;
}

export function MonthlyEmptyState({ title }: { title: string }) {
  return <div className="monthly-review-empty"><span>{title}</span></div>;
}
