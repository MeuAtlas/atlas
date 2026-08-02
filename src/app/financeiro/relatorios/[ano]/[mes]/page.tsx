import Link from "next/link";
import { notFound } from "next/navigation";

import { ValueVisibility } from "@/components/finance/value-visibility";
import { CardStatementReconciliation, MonthlyAttentionList, MonthlyCashFlowSection, MonthlyCloseDialog, MonthlyFutureAndLoans, MonthlyNarrative, MonthlyPerspectiveSections, MonthlyReportVersionHistory, MonthlyStatusBadge, MonthlyStatusBanner, MonthlySummaryCards, MonthlyTransactionsSection, PersonalConsumptionSection, ResponsibilityDistribution } from "@/components/finance/monthly-report-view";
import { getMonthlyReportPreview, getReadableFinanceWorkspace } from "@/modules/finance/monthly-financial-report-query";
import { isBeforeFinancialTracking } from "@/modules/finance/monthly-financial-report";

export default async function MonthlyReportPage({ params, searchParams }: { params: Promise<{ ano: string; mes: string }>; searchParams: Promise<{ workspace?: string }> }) {
  const route = await params;
  const query = await searchParams;
  const year = Number(route.ano); const month = Number(route.mes);
  if (!Number.isInteger(year) || year < 1900 || year > 2200 || !Number.isInteger(month) || month < 1 || month > 12) notFound();
  const context = await getReadableFinanceWorkspace(query.workspace, { fallbackToPersonal: true });
  if (isBeforeFinancialTracking({ year, month, trackingStartYear: context.tracking.startYear, trackingStartMonth: context.tracking.startMonth })) notFound();
  const data = await getMonthlyReportPreview({ supabase: context.supabase, workspaceId: context.workspaceId, year, month, tracking: context.tracking, canCreate: context.canAdmin, ownerId: context.user.id, includeOwnerPrivateData: context.includeOwnerPrivateData });
  const common = { workspaceId: context.workspaceId, year, month };
  const title = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(year, month - 1, 1)));
  const previewPdfUrl = `/api/monthly-reports/preview/${year}/${String(month).padStart(2, "0")}?workspace=${encodeURIComponent(context.workspaceId)}`;
  const currentReport = data.versions.find((version) => version.id === data.financialMonth.current_report_id);
  const peopleResult = await context.supabase.from("financial_people").select("id,name").eq("workspace_id", context.workspaceId).is("archived_at", null).order("name");
  return <ValueVisibility controls={false}><main className="monthly-report-page">
    <header className="monthly-report-header"><div><Link href={`/financeiro/relatorios?workspace=${context.workspaceId}&year=${year}`} prefetch={false}>← Todos os meses</Link><p className="eyebrow">Relatório mensal {data.financialMonth.status === "open" ? "— prévia" : ""}</p><h1 className="capitalize">{title}</h1><p>Período considerado: {data.snapshot.period.startDate.split("-").reverse().join("/")} a {new Date(new Date(data.snapshot.period.endExclusiveInstant).getTime() - 1).toLocaleDateString("pt-BR", { timeZone: data.snapshot.period.timeZone })}</p></div><div className="monthly-report-header-actions"><MonthlyStatusBadge status={data.financialMonth.status} />{data.financialMonth.status === "awaiting_consolidation" ? <div className="monthly-preview-actions"><a href={previewPdfUrl} target="_blank" rel="noreferrer">Ver prévia do PDF</a><a href={`${previewPdfUrl}&download=1`}>Baixar prévia</a></div> : null}{data.financialMonth.status === "closed" && currentReport?.pdf_storage_path ? <div className="monthly-preview-actions"><a href={`/api/monthly-reports/${currentReport.id}/pdf`} target="_blank" rel="noreferrer">Visualizar PDF</a><a href={`/api/monthly-reports/${currentReport.id}/pdf?download=1`}>Baixar PDF</a></div> : null}</div></header>
    {!data.schemaReady ? <div className="monthly-banner warning">A interface está pronta, mas a migration 076 precisa ser aplicada para salvar fechamentos e versões.</div> : null}
    <MonthlyStatusBanner month={data.financialMonth} />
    {data.snapshot.tracking.isFirstFinancialReport ? <div className="monthly-first-note"><strong>Primeiro mês acompanhado pelo Atlas.</strong>{data.snapshot.tracking.isPartialInitialMonth ? <span>O acompanhamento financeiro começou em {new Intl.DateTimeFormat("pt-BR", { day: "numeric", month: "long", timeZone: data.snapshot.period.timeZone }).format(new Date(data.snapshot.tracking.startedAt))}. Este primeiro relatório pode não incluir movimentações anteriores a essa data.</span> : null}</div> : null}
    <MonthlySummaryCards snapshot={data.snapshot} partial={data.financialMonth.status === "open"} />
    <MonthlyNarrative snapshot={data.snapshot} />
    <MonthlyPerspectiveSections snapshot={data.snapshot} />
    <MonthlyCashFlowSection snapshot={data.snapshot} workspaceId={context.workspaceId} />
    <PersonalConsumptionSection snapshot={data.snapshot} />
    <div className="monthly-two-columns"><section className="finance-panel"><header><div><p className="eyebrow">Contas</p><h2>Saldos atuais</h2></div></header><div className="finance-list">{data.snapshot.accounts.map((account) => <div key={account.id}><span><b>{account.name}</b></span><strong>{new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(account.closingBalance)}</strong></div>)}</div></section><section className="finance-panel"><header><div><p className="eyebrow">Valores de terceiros</p><h2>Reembolsos</h2></div></header><div className="monthly-reimbursement"><span>Já recebido<strong>{new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(data.snapshot.totals.reimbursementsReceived)}</strong></span><span>Ainda a receber<strong>{new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(data.snapshot.totals.reimbursementsPending)}</strong></span></div><p>Valores pendentes não impedem o fechamento quando a responsabilidade está definida.</p></section></div>
    <section className="finance-panel"><header><div><p className="eyebrow">Cartões</p><h2>Conferência das faturas</h2></div>{data.financialMonth.status !== "closed" ? <Link href={`/financeiro/cartoes/importar-fatura?workspace=${context.workspaceId}`} prefetch={false}>Enviar PDF</Link> : null}</header><p className="monthly-explanation">O consumo do mês considera compras feitas entre o primeiro e o último dia. O valor da fatura pode ser diferente porque o ciclo do cartão atravessa dois meses.</p><div className="statement-grid">{data.snapshot.statements.length ? data.snapshot.statements.map((statement) => <CardStatementReconciliation key={statement.id} statement={statement} common={common} editable={data.financialMonth.status !== "closed"} />) : <p>Nenhuma fatura relevante foi encontrada para este período.</p>}</div></section>
    <div className="monthly-two-columns">{data.financialMonth.status !== "closed" ? <ResponsibilityDistribution purchases={data.purchases} people={peopleResult.data ?? []} common={common} /> : <section className="finance-panel"><header><div><p className="eyebrow">Quem paga cada parte</p><h2>Responsabilidades preservadas</h2></div></header><div className="monthly-reimbursement"><span>Sua parte no cartão<strong>{new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(data.snapshot.totals.personalCardConsumption ?? data.snapshot.totals.totalCardConsumption - data.snapshot.totals.thirdPartyCardConsumption)}</strong></span><span>Parte de terceiros<strong>{new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(data.snapshot.totals.thirdPartyCardConsumption)}</strong></span></div></section>}<MonthlyAttentionList snapshot={data.snapshot} /></div>
    <MonthlyFutureAndLoans snapshot={data.snapshot} />
    <MonthlyTransactionsSection snapshot={data.snapshot} />
    {data.versions.length ? <MonthlyReportVersionHistory versions={data.versions} common={common} /> : null}
    <MonthlyCloseDialog month={data.financialMonth} snapshot={data.snapshot} canAdmin={context.canAdmin && data.schemaReady} common={common} />
  </main></ValueVisibility>;
}
