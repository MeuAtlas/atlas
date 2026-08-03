import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  createFinancialMonthIfNeeded,
  getMonthlyReportPreview,
  type FinancialMonthRecord,
  type MonthlyReportRecord,
} from "./monthly-financial-report-query";
import {
  financeToday,
  getFinancialMonthDisplayState,
  getStatementForCashMonth,
  selectActiveFinancialMonths,
  selectClosedFinancialMonths,
  shiftMonth,
  type ActiveFinancialMonth,
} from "./financial-reports-list";

type MonthWithReport = FinancialMonthRecord & {
  monthly_financial_reports?: MonthlyReportRecord | MonthlyReportRecord[] | null;
};

export async function ensureCurrentAndNextFinancialMonths(input: {
  supabase: SupabaseClient;
  workspaceId: string;
  tracking: { startedAt: string; startYear: number; startMonth: number };
  canCreate: boolean;
  now?: Date;
}) {
  const current = financeToday(input.now);
  const next = shiftMonth(current, 1);
  const ensureMonth = async (value: { year: number; month: number }) => {
    try {
      return await createFinancialMonthIfNeeded(input.supabase, input.workspaceId,
        value.year, value.month, input.tracking, input.canCreate);
    } catch (error) {
      if (!input.canCreate && error instanceof RangeError) return null;
      throw error;
    }
  };
  const [currentMonth, nextMonth] = await Promise.all([ensureMonth(current), ensureMonth(next)]);
  if (!currentMonth) return { current, currentMonth: null, nextMonth };
  if (input.canCreate && currentMonth.status === "planned") {
    const transitioned = await input.supabase.from("financial_months")
      .update({ status: "open" }).eq("id", currentMonth.id).select("*").single();
    if (transitioned.error) throw new Error("Não foi possível iniciar o mês financeiro vigente.");
    return { current, currentMonth: transitioned.data as FinancialMonthRecord, nextMonth };
  }
  return { current, currentMonth, nextMonth };
}

export async function getFinancialReportsPageData(input: {
  supabase: SupabaseClient;
  workspaceId: string;
  tracking: { startedAt: string; startYear: number; startMonth: number };
  canCreate: boolean;
  ownerId: string;
  includeOwnerPrivateData: boolean;
  historyYear?: number;
  now?: Date;
}) {
  const ensured = await ensureCurrentAndNextFinancialMonths(input);
  const monthsResult = await input.supabase.from("financial_months")
    .select("*,monthly_financial_reports!financial_months_current_report_id_fkey(id,version,status,snapshot_json,pdf_storage_path,generated_at)")
    .eq("workspace_id", input.workspaceId)
    .order("reference_year", { ascending: false })
    .order("reference_month", { ascending: false });
  if (monthsResult.error) throw new Error("Não foi possível carregar os relatórios financeiros.");
  const allMonths = (monthsResult.data ?? []) as MonthWithReport[];
  const activeCandidates = selectActiveFinancialMonths(allMonths, ensured.current);
  const active = await Promise.all(activeCandidates.map(async month => {
    const preview = await getMonthlyReportPreview({
      supabase: input.supabase,
      workspaceId: input.workspaceId,
      year: month.reference_year,
      month: month.reference_month,
      tracking: input.tracking,
      canCreate: input.canCreate,
      ownerId: input.ownerId,
      includeOwnerPrivateData: input.includeOwnerPrivateData,
    });
    const displayStatus = getFinancialMonthDisplayState({
      month,
      current: ensured.current,
      hasBlockingIssues: preview.snapshot.issues.some(issue => issue.severity === "blocking"),
    });
    return {
      month,
      displayStatus,
      snapshot: preview.snapshot,
      card: getStatementForCashMonth({
        statements: preview.statements,
        reconciliationStatements: preview.reconciliationStatements,
        unmatchedPaymentCount: preview.paymentCandidates.length,
      }),
    } satisfies ActiveFinancialMonth;
  }));
  const historyMonths = input.historyYear
    ? allMonths.filter(month => month.reference_year === input.historyYear)
    : allMonths;
  return {
    current: ensured.current,
    active,
    closed: selectClosedFinancialMonths(historyMonths),
    closedTotal: historyMonths.filter(month => month.status === "closed" || Boolean(month.current_report_id)).length,
  };
}
