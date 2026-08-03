import Link from "next/link";
import { notFound } from "next/navigation";

import { PlannedFinancialMonthOverview } from "@/components/finance/financial-reports-list";
import {
  MonthlyBlockingIssues,
  MonthlyCashFlowReviewSection,
  MonthlyCloseSection,
  MonthlyCommitmentsSection,
  MonthlyConsumptionSection,
  MonthlyFinalReview,
  MonthlyFutureSection,
  MonthlyIncomeSection,
  MonthlyInstallmentsSection,
  MonthlyLoansSection,
  MonthlyNextStatementSection,
  MonthlyPaidCardSection,
  MonthlyReportHeader,
  MonthlyReportNotice,
  MonthlyResponsiblePurchases,
  MonthlySummaryGrid,
  MonthlyAtlasReading,
} from "@/components/finance/monthly-report-review-view";
import {
  MonthlyFutureAndLoans,
  MonthlyProjectionSection,
  MonthlyReportVersionHistory,
  MonthlyStatusBadge,
  MonthlyStatusBanner,
  MonthlyTransactionsSection,
} from "@/components/finance/monthly-report-view";
import { ValueVisibility } from "@/components/finance/value-visibility";
import { getStatementForCashMonth } from "@/modules/finance/financial-reports-list";
import { isBeforeFinancialTracking } from "@/modules/finance/monthly-financial-report";
import { getMonthlyReportPreview, getReadableFinanceWorkspace } from "@/modules/finance/monthly-financial-report-query";
import { buildMonthlyReportReviewViewModel } from "@/modules/finance/monthly-report-review";

export default async function MonthlyReportPage({ params, searchParams }: {
  params: Promise<{ ano: string; mes: string }>;
  searchParams: Promise<{ workspace?: string; financialProfile?: string; profile?: string; account?: string; person?: string }>;
}) {
  const route = await params;
  const query = await searchParams;
  const year = Number(route.ano);
  const month = Number(route.mes);
  if (!Number.isInteger(year) || year < 1900 || year > 2200 ||
    !Number.isInteger(month) || month < 1 || month > 12) notFound();
  const context = await getReadableFinanceWorkspace(query.workspace, {
    fallbackToPersonal: !query.workspace,
  });
  if (isBeforeFinancialTracking({
    year, month,
    trackingStartYear: context.tracking.startYear,
    trackingStartMonth: context.tracking.startMonth,
  })) notFound();
  const data = await getMonthlyReportPreview({
    supabase: context.supabase,
    workspaceId: context.workspaceId,
    year,
    month,
    tracking: context.tracking,
    canCreate: context.canAdmin,
    ownerId: context.user.id,
    includeOwnerPrivateData: context.includeOwnerPrivateData,
  });
  const common = { workspaceId: context.workspaceId, year, month };
  const preserved = new URLSearchParams({ workspace: context.workspaceId });
  for (const key of ["financialProfile", "profile", "account", "person"] as const) {
    if (query[key]) preserved.set(key, query[key]);
  }
  const title = new Intl.DateTimeFormat("pt-BR", {
    month: "long", year: "numeric", timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, 1)));
  const backUrl = `/financeiro/relatorios?${preserved.toString()}&year=${year}`;
  const previewPdfUrl = `/api/monthly-reports/preview/${year}/${String(month).padStart(2, "0")}?${preserved.toString()}`;
  const currentReport = data.versions.find(version =>
    version.id === data.financialMonth.current_report_id);

  if (data.financialMonth.status === "planned") {
    const card = getStatementForCashMonth({
      statements: data.statements,
      reconciliationStatements: data.reconciliationStatements,
      unmatchedPaymentCount: data.paymentCandidates.length,
    });
    return <ValueVisibility controls={false}><main className="monthly-report-page planned-month-page">
      <header className="monthly-report-header"><div><Link href={backUrl} prefetch={false}>← Todos os meses</Link><p className="eyebrow">Planejamento mensal</p><h1 className="capitalize">{title}</h1><p>Previsões conhecidas para o período, sem alterar o caixa real.</p></div><MonthlyStatusBadge status="planned" /></header>
      <MonthlyStatusBanner month={data.financialMonth} />
      <PlannedFinancialMonthOverview snapshot={data.snapshot} card={card} />
      <MonthlyProjectionSection snapshot={data.snapshot} />
      <MonthlyFutureAndLoans snapshot={data.snapshot} />
    </main></ValueVisibility>;
  }

  const view = buildMonthlyReportReviewViewModel({
    financialMonth: data.financialMonth,
    snapshot: data.snapshot,
    statements: data.statements,
    reconciliationStatements: data.reconciliationStatements,
    openStatements: data.openStatements,
    paymentCandidates: data.paymentCandidates,
    purchases: data.purchases,
    versions: data.versions,
  });
  const movementsUrl = `/financeiro/movimentacoes?workspace=${context.workspaceId}&month=${data.snapshot.period.key}`;
  const invoiceUploadUrl = `/financeiro/cartoes/importar-fatura?workspace=${context.workspaceId}`;
  const finalPdfUrl = data.financialMonth.status === "closed" && currentReport?.pdf_storage_path
    ? `/api/monthly-reports/${currentReport.id}/pdf`
    : null;

  return <ValueVisibility controls={false}><main className="monthly-report-page monthly-review-page">
    <MonthlyReportHeader view={view} backUrl={backUrl} previewPdfUrl={previewPdfUrl} finalPdfUrl={finalPdfUrl} />
    {!data.schemaReady ? <div className="monthly-review-notice warning">A estrutura de fechamento ainda precisa ser atualizada antes de salvar versões.</div> : null}
    <MonthlyReportNotice view={view} />
    <MonthlyBlockingIssues view={view} common={common} />
    <MonthlySummaryGrid view={view} />
    <MonthlyAtlasReading view={view} />
    <MonthlyCashFlowReviewSection view={view} snapshot={data.snapshot} workspaceId={context.workspaceId} />
    <MonthlyIncomeSection view={view} movementsUrl={movementsUrl} />
    <MonthlyConsumptionSection view={view} movementsUrl={movementsUrl} />
    <MonthlyCommitmentsSection view={view} movementsUrl={movementsUrl} />
    <div className="monthly-card-review-grid">
      <MonthlyPaidCardSection view={view} invoiceUploadUrl={invoiceUploadUrl} />
      <MonthlyNextStatementSection view={view} />
    </div>
    <MonthlyResponsiblePurchases view={view} people={data.people} common={common} />
    <MonthlyInstallmentsSection view={view} />
    <MonthlyLoansSection snapshot={data.snapshot} />
    <MonthlyFutureSection view={view} />
    <MonthlyFinalReview view={view} />
    <details className="monthly-review-section monthly-technical-details"><summary>Detalhes e movimentações</summary><div><MonthlyTransactionsSection snapshot={data.snapshot} />{data.versions.length ? <MonthlyReportVersionHistory versions={data.versions} common={common} /> : null}</div></details>
    <MonthlyCloseSection view={view} snapshot={data.snapshot} common={common} monthId={data.financialMonth.id} canAdmin={context.canAdmin && data.schemaReady} />
  </main></ValueVisibility>;
}
