import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { requireFinanceAccess } from "./access";
import { buildCurrentCardInvoices } from "./card-invoices";
import {
  buildMonthlySnapshot,
  availableFinancialMonths,
  getMonthlyPeriod,
  isRealIncomeEntry,
  isStatementForMonthlyConsumption,
  isBeforeFinancialTracking,
  resolveMonthlyPurchaseResponsibility,
  resolveAutomaticMonthStatus,
  type FinancialMonthStatus,
  type MonthlyAllocation,
  type MonthlyCardPurchase,
  type MonthlyReportSnapshot,
  type MonthlyStatement,
} from "./monthly-financial-report";
import {
  getFinanceProjectionCardData,
  getReliableCurrentInvoiceSnapshots,
  resolveOpenCardInvoice,
} from "./queries";
import { calculateMonthlyFinancialResult, shiftFinanceMonth } from "./monthly-result";
import { getMonthlyFinancialCommitments } from "./commitments-query";
import { calculateHistoricalMonthlyIncomeMedian } from "./income-expenses";
import {
  buildInvoiceHistoryAnalytics,
  HISTORICAL_INVOICE_STATUSES,
  resolveHistoricalInvoiceTotal,
  type HistoricalInvoiceStatus,
} from "./invoice-history";
import type { FinancialTransaction, StoredCardInvoice } from "./types";

type Client = SupabaseClient;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type FinancialMonthRecord = {
  id: string;
  workspace_id: string;
  reference_year: number;
  reference_month: number;
  period_start: string;
  period_end: string;
  timezone: string;
  status: FinancialMonthStatus;
  recommended_close_at: string | null;
  closed_at: string | null;
  current_report_id: string | null;
  tracking_started_at?: string | null;
  available_data_start_at?: string | null;
  is_first_financial_report?: boolean;
  is_partial_initial_month?: boolean;
  report_origin?: "live_tracked" | "historically_reconstructed";
};

export type MonthlyReportRecord = {
  id: string;
  version: number;
  status: "draft" | "generating" | "final" | "generation_failed" | "superseded";
  snapshot_json: MonthlyReportSnapshot;
  pdf_storage_path: string | null;
  generated_at: string;
};

export async function getReadableFinanceWorkspace(
  requestedWorkspaceId?: string | null,
  options: { fallbackToPersonal?: boolean } = {},
) {
  const access = await requireFinanceAccess();
  const memberships = await access.supabase
    .from("workspace_members")
    .select("workspace_id,role,status,workspaces!inner(id,name,type,owner_id)")
    .eq("user_id", access.user.id)
    .eq("status", "active")
    .order("created_at");
  if (memberships.error) throw new Error("Não foi possível localizar seus espaços financeiros.");
  const rows = memberships.data ?? [];
  const normalizedRequestedId = requestedWorkspaceId && UUID.test(requestedWorkspaceId)
    ? requestedWorkspaceId
    : null;
  const personal = rows.find((row) => {
    const value = row.workspaces as unknown as { type?: string; owner_id?: string } | Array<{ type?: string; owner_id?: string }> | null;
    const workspace = Array.isArray(value) ? value[0] : value;
    return workspace?.type === "personal" && workspace.owner_id === access.user.id;
  });
  const requested = normalizedRequestedId
    ? rows.find((row) => row.workspace_id === normalizedRequestedId)
    : null;
  const mayFallback = options.fallbackToPersonal || !normalizedRequestedId;
  const selected = requested ?? (mayFallback ? personal ?? rows[0] : null);
  if (!selected) {
    throw new Error("Você não possui acesso a este espaço financeiro.");
  }
  const workspaceValue = selected.workspaces as unknown as { id: string; name: string; type: string; owner_id: string } | Array<{ id: string; name: string; type: string; owner_id: string }>;
  const workspace = Array.isArray(workspaceValue) ? workspaceValue[0] : workspaceValue;
  const trackingResult = await access.supabase.from("profiles").select("financial_tracking_started_at,financial_tracking_start_year,financial_tracking_start_month,financial_tracking_start_source").eq("id", access.user.id).maybeSingle();
  const schemaMissing = isMissingMonthlySchema(trackingResult.error);
  const fallback = schemaMissing ? { year: 2026, month: 7, startedAt: "2026-07-01T03:00:00.000Z", source: "migration" } : { year: new Date().getFullYear(), month: new Date().getMonth() + 1, startedAt: new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString(), source: "finance_module_activation" };
  const sharedParticipation = !schemaMissing && workspace?.owner_id !== access.user.id
    ? await access.supabase.from("workspace_financial_memberships").select("financial_participation_started_at,financial_people!inner(user_id)").eq("workspace_id", selected.workspace_id).eq("financial_people.user_id", access.user.id).eq("include_in_shared_reports", true).maybeSingle()
    : { data: null };
  const participationStartedAt = sharedParticipation.data?.financial_participation_started_at ? String(sharedParticipation.data.financial_participation_started_at) : null;
  const participationDate = participationStartedAt ? new Date(participationStartedAt) : null;
  const trackingStartYear = participationDate ? Number(new Intl.DateTimeFormat("en", { year: "numeric", timeZone: "America/Fortaleza" }).format(participationDate)) : Number(trackingResult.data?.financial_tracking_start_year ?? fallback.year);
  const trackingStartMonth = participationDate ? Number(new Intl.DateTimeFormat("en", { month: "numeric", timeZone: "America/Fortaleza" }).format(participationDate)) : Number(trackingResult.data?.financial_tracking_start_month ?? fallback.month);
  return {
    ...access,
    workspaceId: String(selected.workspace_id),
    workspaceName: workspace?.name ?? "Meu espaço",
    workspaceType: workspace?.type ?? "personal",
    workspaceOwnerId: workspace?.owner_id ?? access.user.id,
    includeOwnerPrivateData: workspace?.type === "personal" && workspace?.owner_id === access.user.id,
    membershipRole: String(selected.role),
    canAdmin: ["owner", "admin"].includes(String(selected.role)),
    tracking: {
      startedAt: participationStartedAt ?? String(trackingResult.data?.financial_tracking_started_at ?? fallback.startedAt),
      startYear: trackingStartYear,
      startMonth: trackingStartMonth,
      source: participationStartedAt ? "manual_configuration" : String(trackingResult.data?.financial_tracking_start_source ?? fallback.source),
      schemaReady: !schemaMissing,
    },
  };
}

function isMissingMonthlySchema(error: { code?: string } | null) {
  return ["42P01", "PGRST204", "PGRST205"].includes(error?.code ?? "");
}

function recommendedCloseAt(year: number, month: number, closingDays: number[]) {
  if (!closingDays.length) return null;
  const day = Math.max(...closingDays.map((value) => Math.min(28, Math.max(1, value))));
  const next = new Date(Date.UTC(year, month, day, 12));
  return next.toISOString();
}

export async function createFinancialMonthIfNeeded(
  supabase: Client,
  workspaceId: string,
  year: number,
  month: number,
  tracking?: { startedAt: string; startYear: number; startMonth: number },
  allowCreate = true,
) {
  const period = getMonthlyPeriod(year, month);
  if (tracking && isBeforeFinancialTracking({ year, month, trackingStartYear: tracking.startYear, trackingStartMonth: tracking.startMonth })) {
    throw new RangeError("Este mês é anterior ao início do acompanhamento financeiro.");
  }
  const existing = await supabase.from("financial_months").select("*")
    .eq("workspace_id", workspaceId).eq("reference_year", year)
    .eq("reference_month", month).maybeSingle();
  if (existing.data) return existing.data as FinancialMonthRecord;
  if (!allowCreate) throw new RangeError("Este relatório ainda não foi compartilhado ou criado.");

  const cards = await supabase.from("credit_cards").select("closing_day")
    .eq("workspace_id", workspaceId).eq("status", "active");
  const recommendation = recommendedCloseAt(year, month, (cards.data ?? []).map((card) => Number(card.closing_day)).filter(Boolean));
  const status = resolveAutomaticMonthStatus({ period, recommendedCloseAt: recommendation });
  const inserted = await supabase.from("financial_months").insert({
    workspace_id: workspaceId,
    reference_year: year,
    reference_month: month,
    period_start: period.startInstant,
    period_end: period.endExclusiveInstant,
    timezone: period.timeZone,
    status,
    recommended_close_at: recommendation,
    tracking_started_at: tracking?.startedAt ?? period.startInstant,
    available_data_start_at: tracking && year === tracking.startYear && month === tracking.startMonth ? tracking.startedAt : period.startInstant,
    is_first_financial_report: Boolean(tracking && year === tracking.startYear && month === tracking.startMonth),
    is_partial_initial_month: Boolean(tracking && year === tracking.startYear && month === tracking.startMonth && new Intl.DateTimeFormat("en", { day: "numeric", timeZone: period.timeZone }).format(new Date(tracking.startedAt)) !== "1"),
    report_origin: "live_tracked",
  }).select("*").single();
  if (inserted.error) {
    if (isMissingMonthlySchema(inserted.error)) {
      return {
        id: `pending-${workspaceId}-${period.key}`,
        workspace_id: workspaceId,
        reference_year: year,
        reference_month: month,
        period_start: period.startInstant,
        period_end: period.endExclusiveInstant,
        timezone: period.timeZone,
        status,
        recommended_close_at: recommendation,
        closed_at: null,
        current_report_id: null,
        tracking_started_at: tracking?.startedAt ?? period.startInstant,
        available_data_start_at: tracking?.startedAt ?? period.startInstant,
        is_first_financial_report: Boolean(tracking && year === tracking.startYear && month === tracking.startMonth),
        is_partial_initial_month: false,
        report_origin: "live_tracked",
      } satisfies FinancialMonthRecord;
    }
    throw new Error("Não foi possível preparar este mês financeiro.");
  }
  return inserted.data as FinancialMonthRecord;
}

export async function getFinancialMonths(input: {
  supabase: Client;
  workspaceId: string;
  year: number;
  tracking: { startedAt: string; startYear: number; startMonth: number };
  canCreate?: boolean;
}) {
  const monthNumbers = availableFinancialMonths({ year: input.year, trackingStartYear: input.tracking.startYear, trackingStartMonth: input.tracking.startMonth });
  if (input.canCreate ?? true) {
    await Promise.all(monthNumbers.map((month) =>
      createFinancialMonthIfNeeded(input.supabase, input.workspaceId, input.year, month, input.tracking, true)));
  }
  const result = await input.supabase.from("financial_months")
    .select("*,monthly_financial_reports!financial_months_current_report_id_fkey(id,version,status,snapshot_json,pdf_storage_path,generated_at)")
    .eq("workspace_id", input.workspaceId).eq("reference_year", input.year)
    .order("reference_month");
  if (result.error && !isMissingMonthlySchema(result.error)) {
    throw new Error("Não foi possível carregar os relatórios mensais.");
  }
  if (!result.data) {
    if (input.canCreate === false) return [];
    return Promise.all(monthNumbers.map((month) =>
      createFinancialMonthIfNeeded(input.supabase, input.workspaceId, input.year, month, input.tracking, input.canCreate ?? true)));
  }
  return result.data.filter((row) => monthNumbers.includes(Number(row.reference_month)));
}

function toStatement(row: Record<string, unknown>, cardNames: Map<string, string>): MonthlyStatement {
  const official = row.official_total_amount ?? row.confirmed_invoice_total ?? row.manual_invoice_total ?? row.provider_invoice_total;
  const calculated = row.calculated_total_amount ?? row.calculated_invoice_total ?? row.total_amount ?? 0;
  return {
    id: String(row.id),
    card_id: String(row.card_id),
    card_name: cardNames.get(String(row.card_id)) ?? "Cartão",
    official_total_amount: official == null ? null : Number(official),
    calculated_total_amount: Number(calculated),
    reconciliation_difference: official == null ? null : Number(official) - Number(calculated),
    reconciliation_status: row.reconciliation_status == null ? null : String(row.reconciliation_status),
    official_amount_confirmed: Boolean(row.official_amount_confirmed ?? row.confirmed_invoice_total),
    closing_date: String(row.closing_date),
    due_date: String(row.due_date),
    cycle_start_date: row.statement_period_start ? String(row.statement_period_start) : row.cycle_start_date ? String(row.cycle_start_date) : null,
    cycle_end_date: row.statement_period_end ? String(row.statement_period_end) : row.cycle_end_date ? String(row.cycle_end_date) : null,
    statement_file_path: row.statement_file_path ? String(row.statement_file_path) : null,
    reference_month: row.reference_month ? String(row.reference_month) : null,
  };
}

export async function getMonthlyReportPreview(input: {
  supabase: Client;
  workspaceId: string;
  year: number;
  month: number;
  tracking?: { startedAt: string; startYear: number; startMonth: number };
  canCreate?: boolean;
  ownerId?: string;
  includeOwnerPrivateData?: boolean;
}) {
  const { supabase, workspaceId, year, month } = input;
  const period = getMonthlyPeriod(year, month);
  const financialMonth = await createFinancialMonthIfNeeded(supabase, workspaceId, year, month, input.tracking, input.canCreate ?? true);
  const personalScope = Boolean(input.includeOwnerPrivateData && input.ownerId);
  const scopeFilter = personalScope
    ? `and(workspace_id.eq.${workspaceId},visibility.eq.workspace),and(owner_id.eq.${input.ownerId},workspace_id.is.null)`
    : `and(workspace_id.eq.${workspaceId},visibility.eq.workspace)`;
  const historicalIncomeStart = shiftFinanceMonth(period, -12).startDate;
  const loansQuery = personalScope && input.ownerId
    ? supabase.from("financial_loans").select("id,name,institution_name,outstanding_balance,installment_amount,installments_remaining,next_installment_date,payroll_deducted,status").eq("owner_id", input.ownerId).neq("status", "unavailable")
    : supabase.from("financial_loans").select("id,name,institution_name,outstanding_balance,installment_amount,installments_remaining,next_installment_date,payroll_deducted,status").eq("workspace_id", workspaceId).neq("status", "unavailable");
  const [accountsResult, transactionsResult, historicalIncomeResult, subsequentTransactionsResult, purchasesResult, cardsResult, invoicesResult, historicalInvoicesResult, allocationsResult, versionsResult, commitmentMonths, loansResult] = await Promise.all([
    supabase.from("financial_accounts").select("id,name,opening_balance,current_balance,last_sync_at").or(scopeFilter).eq("status", "active"),
    supabase.from("financial_transactions").select("*,financial_accounts:financial_accounts!financial_transactions_account_id_fkey(name,institution_name),credit_cards:credit_cards!financial_transactions_credit_card_id_fkey(name,last_four_digits),financial_categories:financial_categories!financial_transactions_category_id_fkey(name)").or(scopeFilter).or("migrated_card_purchase_id.is.null,transaction_role.eq.invoice_payment,cash_flow_kind.eq.invoice_payment").gte("competence_date", period.startDate).lt("competence_date", period.endExclusiveDate),
    supabase.from("financial_transactions").select("*").or(scopeFilter).or("migrated_card_purchase_id.is.null,transaction_role.eq.invoice_payment,cash_flow_kind.eq.invoice_payment").gte("competence_date", historicalIncomeStart).lt("competence_date", period.startDate),
    supabase.from("financial_transactions").select("*").or(scopeFilter).or("migrated_card_purchase_id.is.null,transaction_role.eq.invoice_payment,cash_flow_kind.eq.invoice_payment").gte("competence_date", period.endExclusiveDate).lte("competence_date", new Date().toISOString().slice(0, 10)),
    supabase.from("card_purchases").select("*,credit_cards:credit_cards!card_purchases_card_id_fkey(name,institution_name,last_four_digits),credit_card_instruments:credit_card_instruments!card_purchases_instrument_id_fkey(display_name,last_four_digits,card_kind,payment_responsible_person_id,default_financial_responsible_id,responsibility_mode),financial_categories:financial_categories!card_purchases_category_id_fkey(name)").or(scopeFilter).or(`and(competence_date.gte.${period.startDate},competence_date.lt.${period.endExclusiveDate}),and(competence_date.is.null,purchase_date.gte.${period.startDate},purchase_date.lt.${period.endExclusiveDate})`),
    supabase.from("credit_cards").select("id,name,last_four_digits,closing_day,due_day,last_sync_at").or(scopeFilter).eq("status", "active"),
    supabase.from("card_invoices").select("*").gte("closing_date", period.startDate).lt("closing_date", new Date(Date.UTC(year, month + 1, 15)).toISOString().slice(0, 10)),
    supabase.from("card_invoices").select("id,card_id,due_date,status,provider_invoice_total,manual_invoice_total,confirmed_invoice_total,calculated_invoice_total,total_source").or(scopeFilter).in("status", [...HISTORICAL_INVOICE_STATUSES]).lt("closing_date", period.endExclusiveDate).order("due_date", { ascending: false }).limit(60),
    supabase.from("expense_allocations").select("*,financial_people:financial_people!expense_allocations_person_id_fkey(name)").eq("workspace_id", workspaceId).is("archived_at", null),
    financialMonth.id.startsWith("pending-") ? Promise.resolve({ data: [], error: null }) : supabase.from("monthly_financial_reports").select("*").eq("financial_month_id", financialMonth.id).order("version", { ascending: false }),
    getMonthlyFinancialCommitments(supabase, { workspaceId, from: shiftFinanceMonth(period, 1).startDate }),
    loansQuery,
  ]);
  const sources = [
    ["contas", accountsResult],
    ["movimentações bancárias", transactionsResult],
    ["histórico de receitas", historicalIncomeResult],
    ["movimentações posteriores", subsequentTransactionsResult],
    ["compras no cartão", purchasesResult],
    ["cartões", cardsResult],
    ["faturas", invoicesResult],
    ["histórico de faturas", historicalInvoicesResult],
    ["rateios e reembolsos", allocationsResult],
    ["empréstimos", loansResult],
  ] as const;
  const failedSource = sources.find(([, result]) => result.error);
  if (failedSource) {
    const [source, result] = failedSource;
    console.error("[MonthlyFinancialReportQuery]", {
      source,
      code: result.error?.code ?? null,
      message: result.error?.message ?? null,
      details: result.error?.details ?? null,
      hint: result.error?.hint ?? null,
    });
    throw new Error(`Não foi possível carregar ${source} deste mês.`);
  }
  const cards = cardsResult.data ?? [];
  const cardIds = new Set(cards.map((card) => String(card.id)));
  const cardNames = new Map(cards.map((card) => [String(card.id), String(card.name)]));
  const invoiceConsumptionReference = shiftFinanceMonth(period, 1).key;
  const monthInvoiceRows = (invoicesResult.data ?? []).filter((row) => {
    if (!cardIds.has(String(row.card_id))) return false;
    return String(row.reference_month ?? "").slice(0, 7) === invoiceConsumptionReference;
  });
  const statements = monthInvoiceRows
    .map((row) => toStatement(row as Record<string, unknown>, cardNames))
    .filter((statement) => isStatementForMonthlyConsumption(statement, period));
  const monthlyPurchases = (purchasesResult.data ?? [])
    .map((row) => resolveMonthlyPurchaseResponsibility(row as MonthlyCardPurchase));
  const resolvedMonthInvoices = await Promise.all(monthInvoiceRows.map((row) =>
    resolveOpenCardInvoice(supabase, input.ownerId ?? "", {
      workspaceId: personalScope ? null : workspaceId,
      cycleId: String(row.id),
      referenceDate: row.due_date ? String(row.due_date) : period.endExclusiveDate,
    })));
  let forecastCardInvoice = resolvedMonthInvoices.reduce((sum, invoice, index) => {
    if (invoice?.displayTotal != null) return sum + invoice.displayTotal;
    const fallback = toStatement(monthInvoiceRows[index] as Record<string, unknown>, cardNames);
    return sum + (fallback.official_total_amount ?? fallback.calculated_total_amount);
  }, 0);
  if (!monthInvoiceRows.length && input.ownerId) {
    const projectionWorkspaceId = personalScope ? null : workspaceId;
    const [projectionData, storedInvoices, installmentOccurrences] = await Promise.all([
      getFinanceProjectionCardData(supabase, input.ownerId, projectionWorkspaceId),
      getReliableCurrentInvoiceSnapshots(supabase, input.ownerId, projectionWorkspaceId),
      supabase.from("card_installment_occurrences")
        .select("card_id,installment_plan_id,amount,status,competence_month")
        .eq("workspace_id", workspaceId)
        .eq("competence_month", `${invoiceConsumptionReference}-01`)
        .in("status", ["projected", "confirmed"]),
    ]);
    const cycleReferenceDate = new Date(new Date(period.endExclusiveInstant).valueOf() - 1);
    const projectedInvoices = buildCurrentCardInvoices(
      projectionData.cards.filter((card) => card.status === "active" && !card.user_archived_at),
      projectionData.cardPurchases,
      cycleReferenceDate,
      { purchaseDataAvailable: !projectionData.partial, storedInvoices },
    ).filter((invoice) => invoice.cycle?.referenceMonth === invoiceConsumptionReference);
    const materializedPlans = new Set(projectedInvoices.flatMap((invoice) =>
      invoice.purchases.map((purchase) => purchase.installment_plan_id).filter(Boolean)));
    const activeCardIds = new Set(projectionData.cards.filter((card) =>
      card.status === "active" && !card.user_archived_at).map((card) => card.id));
    const unmaterializedInstallments = installmentOccurrences.error
      ? 0
      : (installmentOccurrences.data ?? []).reduce((sum, occurrence) =>
          activeCardIds.has(String(occurrence.card_id)) &&
          !materializedPlans.has(String(occurrence.installment_plan_id))
            ? sum + Math.abs(Number(occurrence.amount) || 0)
            : sum, 0);
    forecastCardInvoice = projectedInvoices.reduce((sum, invoice) =>
      sum + invoice.invoiceTotal, 0) + unmaterializedInstallments;
  }
  const allocations = (allocationsResult.data ?? []).map((row) => ({
    ...row,
    person_name: Array.isArray(row.financial_people) ? row.financial_people[0]?.name : (row.financial_people as { name?: string } | null)?.name,
  })) as MonthlyAllocation[];
  const accounts = (accountsResult.data ?? []).map((account) => ({ id: String(account.id), name: String(account.name), openingBalance: Number(account.opening_balance), closingBalance: Number(account.current_balance), lastSyncAt: account.last_sync_at ? String(account.last_sync_at) : null }));
  const availableDates = [
    ...(transactionsResult.data ?? []).map((row) => String(row.competence_date ?? "")),
    ...(purchasesResult.data ?? []).map((row) => String(row.competence_date ?? row.purchase_date ?? "")),
  ].filter((value) => /^\d{4}-\d{2}-\d{2}/.test(value) && value >= period.startDate && value < period.endExclusiveDate).sort();
  const importedDataStartAt = availableDates[0]
    ? new Date(`${availableDates[0].slice(0, 10)}T00:00:00-03:00`).toISOString()
    : null;
  const configuredAvailableStart = financialMonth.available_data_start_at ?? period.startInstant;
  const availableDataStartAt = importedDataStartAt && importedDataStartAt < configuredAvailableStart
    ? importedDataStartAt
    : configuredAvailableStart;
  const status = resolveAutomaticMonthStatus({ period, persistedStatus: financialMonth.status, recommendedCloseAt: financialMonth.recommended_close_at });
  const calculationScope = {
    workspaceId,
    ownerId: input.ownerId,
    includeOwnerPrivateData: personalScope,
  };
  const historicalIncomeTransactions = (historicalIncomeResult.data ?? []) as FinancialTransaction[];
  const incomeMonthlyTotals = Array.from({ length: 12 }, (_, index) =>
    shiftFinanceMonth(period, index - 12)).flatMap((historicalPeriod) => {
      const monthlyResult = calculateMonthlyFinancialResult({
        transactions: historicalIncomeTransactions,
        purchases: [],
        period: historicalPeriod,
        scope: calculationScope,
      });
      const incomeEntries = monthlyResult.entries.filter(isRealIncomeEntry);
      const totalCents = Math.round(incomeEntries.reduce((sum, entry) => sum + entry.amount, 0) * 100);
      return totalCents > 0 ? [{
        month: `${historicalPeriod.key}-01`,
        totalCents,
        creditsCount: incomeEntries.length,
        hasCoverage: true,
        isComplete: true,
      }] : [];
    });
  const incomeStatistics = calculateHistoricalMonthlyIncomeMedian({
    monthlyTotals: incomeMonthlyTotals,
    maximumMonths: 12,
    includeZeroMonths: false,
    endMonth: period.startDate,
  });
  const historicalInvoiceEntries = (historicalInvoicesResult.data ?? []).flatMap((row) => {
    if (!cardIds.has(String(row.card_id))) return [];
    const status = String(row.status) as HistoricalInvoiceStatus;
    if (!HISTORICAL_INVOICE_STATUSES.includes(status)) return [];
    const resolved = resolveHistoricalInvoiceTotal(row as Pick<StoredCardInvoice,
      "provider_invoice_total" | "manual_invoice_total" | "confirmed_invoice_total" | "calculated_invoice_total" | "total_source">);
    return [{
      id: String(row.id),
      cardId: String(row.card_id),
      dueDate: String(row.due_date),
      status,
      total: resolved.total,
      totalSource: resolved.source,
    }];
  });
  const invoiceAnalytics = buildInvoiceHistoryAnalytics(historicalInvoiceEntries, forecastCardInvoice, 12);
  const futureCommitmentMonths = commitmentMonths.slice(0, 3).map((item) => ({ month: item.competenceMonth.slice(0, 7), amount: item.totalCommittedCents / 100 }));
  const loans = (loansResult.data ?? []).map((loan) => ({
    id: String(loan.id),
    name: String(loan.name ?? "Empréstimo"),
    institution: loan.institution_name ? String(loan.institution_name) : null,
    outstandingBalance: Number(loan.outstanding_balance ?? 0),
    installmentAmount: Number(loan.installment_amount ?? 0),
    remainingInstallments: loan.installments_remaining == null ? null : Number(loan.installments_remaining),
    nextDueDate: loan.next_installment_date ? String(loan.next_installment_date) : null,
    payrollDeducted: Boolean(loan.payroll_deducted),
  }));
  const liveSnapshot = buildMonthlySnapshot({
    period,
    transactions: (transactionsResult.data ?? []) as FinancialTransaction[],
    subsequentTransactions: (subsequentTransactionsResult.data ?? []) as FinancialTransaction[],
    purchases: monthlyPurchases,
    statements,
    allocations,
    accounts,
    forecastCardInvoice,
    incomeHistoricalReference: {
      median: incomeStatistics.medianAmount == null ? null : incomeStatistics.medianAmount / 100,
      months: incomeStatistics.monthsAvailable,
    },
    cardInvoiceHistoricalReference: {
      median: invoiceAnalytics.median,
      months: invoiceAnalytics.months.length,
    },
    futureCommitmentMonths,
    futureCommitments: futureCommitmentMonths[0]?.amount ?? 0,
    loans,
    scope: calculationScope,
    status,
    accountsSyncHealthy: true,
    tracking: {
      startedAt: financialMonth.tracking_started_at ?? input.tracking?.startedAt ?? period.startInstant,
      availableDataStartAt,
      isFirstFinancialReport: financialMonth.is_first_financial_report,
      isPartialInitialMonth: financialMonth.is_partial_initial_month,
      reportOrigin: financialMonth.report_origin,
    },
  });
  const versions = (versionsResult.data ?? []) as MonthlyReportRecord[];
  const currentReport = versions.find((version) => version.id === financialMonth.current_report_id);
  const snapshot = status === "closed" && currentReport?.snapshot_json
    ? currentReport.snapshot_json
    : liveSnapshot;
  return {
    financialMonth: { ...financialMonth, status },
    snapshot,
    cards,
    purchases: monthlyPurchases,
    statements,
    versions,
    schemaReady: !financialMonth.id.startsWith("pending-"),
  };
}
