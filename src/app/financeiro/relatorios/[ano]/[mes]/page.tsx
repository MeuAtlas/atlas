import Link from "next/link";
import { notFound } from "next/navigation";

import { PlannedFinancialMonthOverview } from "@/components/finance/financial-reports-list";
import {
  MonthlyBlockingIssues,
  MonthlyAtlasFlow,
  MonthlyCloseSection,
  MonthlyDetailSheet,
  MonthlyFinalReview,
  MonthlyObservations,
  MonthlyPaidCardSection,
  MonthlyReportHeader,
  MonthlyResponsibleAndReimbursements,
  MonthlySummaryGrid,
} from "@/components/finance/monthly-report-review-view";
import {
  MonthlyReportVersionHistory,
  MonthlyStatusBadge,
  MonthlyStatusBanner,
  MonthlyTransactionsSection,
} from "@/components/finance/monthly-report-view";
import { ValueVisibility } from "@/components/finance/value-visibility";
import { getStatementForCashMonth } from "@/modules/finance/financial-reports-list";
import { getExpenseEstablishmentAnalyses } from "@/modules/finance/expense-establishment-query";
import { isValidEstablishmentTransaction } from "@/modules/finance/expense-establishment-analysis";
import { getIncomeExpenseOverview } from "@/modules/finance/income-expenses-query";
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
    </main></ValueVisibility>;
  }

  const reportMonth = `${year}-${String(month).padStart(2, "0")}`;
  const [registeredFlows, establishmentAnalyses] = await Promise.all([
    getIncomeExpenseOverview(context.supabase, {
      workspaceId: context.workspaceId,
      month: reportMonth,
    }),
    getExpenseEstablishmentAnalyses(
      context.supabase,
      context.workspaceId,
      reportMonth,
    ),
  ]);
  const registeredTransactionIds = new Set(
    [...registeredFlows.incomes, ...registeredFlows.expenses]
      .map(item => item.linkedTransactionId)
      .filter((id): id is string => Boolean(id)),
  );
  const eventualExpenses = establishmentAnalyses.map(analysis => {
    const amountCents = analysis.transactions
      .filter(transaction =>
        transaction.date.startsWith(reportMonth) &&
        !registeredTransactionIds.has(transaction.id) &&
        isValidEstablishmentTransaction(transaction),
      )
      .reduce((sum, transaction) => sum + (
        ["refund", "reversal"].includes(transaction.transactionRole ?? "") ||
        transaction.bankDirection === "inflow"
          ? -transaction.amountCents
          : transaction.amountCents
      ), 0);
    return { description: analysis.name, amount: amountCents / 100 };
  }).filter(item => item.amount > 0);

  const view = buildMonthlyReportReviewViewModel({
    financialMonth: data.financialMonth,
    snapshot: data.snapshot,
    statements: data.statements,
    reconciliationStatements: data.reconciliationStatements,
    openStatements: data.openStatements,
    paymentCandidates: data.paymentCandidates,
    purchases: data.purchases,
    versions: data.versions,
    registeredFlows,
    eventualExpenses,
  });
  const invoiceUploadUrl = `/financeiro/cartoes/importar-fatura?workspace=${context.workspaceId}`;
  const finalPdfUrl = data.financialMonth.status === "closed" && currentReport?.pdf_storage_path
    ? `/api/monthly-reports/${currentReport.id}/pdf`
    : null;

  return <ValueVisibility controls={false}><main className="monthly-report-page monthly-review-page">
    <MonthlyReportHeader view={view} backUrl={backUrl} previewPdfUrl={previewPdfUrl} finalPdfUrl={finalPdfUrl} />
    {!data.schemaReady ? <div className="monthly-review-notice warning">A estrutura de fechamento ainda precisa ser atualizada antes de salvar versões.</div> : null}
    <MonthlySummaryGrid view={view} />
    <MonthlyAtlasFlow view={view} snapshot={data.snapshot} workspaceId={context.workspaceId} />
    <MonthlyDetailSheet view={view} />
    <MonthlyPaidCardSection
      view={view}
      invoiceUploadUrl={invoiceUploadUrl}
      ownerName={context.profile.preferred_name || context.profile.full_name || "Minha parte"}
    />
    <MonthlyResponsibleAndReimbursements view={view} />
    <MonthlyBlockingIssues view={view} common={common} />
    <MonthlyFinalReview view={view} />
    <MonthlyObservations view={view} />
    <details className="monthly-review-section monthly-technical-details"><summary>Detalhes e movimentações</summary><div><MonthlyTransactionsSection snapshot={data.snapshot} />{data.versions.length ? <MonthlyReportVersionHistory versions={data.versions} common={common} /> : null}</div></details>
    <MonthlyCloseSection view={view} snapshot={data.snapshot} common={common} monthId={data.financialMonth.id} canAdmin={context.canAdmin && data.schemaReady} />
  </main></ValueVisibility>;
}
