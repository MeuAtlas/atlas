import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { requireFinanceAccess } from "./access";
import { buildCurrentCardInvoices } from "./card-invoices";
import {
  buildMonthlySnapshot,
  availableFinancialMonths,
  getMonthlyPeriod,
  isRealIncomeEntry,
  isBeforeFinancialTracking,
  mergeDependentCostsIntoRecurringGroups,
  resolveMonthlyPurchaseResponsibility,
  resolveAutomaticMonthStatus,
  type FinancialMonthStatus,
  type MonthlyAllocation,
  type MonthlyCardPurchase,
  type MonthlyReportSnapshot,
  type MonthlyStatement,
  type MonthlyStatementPayment,
} from "./monthly-financial-report";
import {
  calculateStatementPaymentStatus,
  identifyCreditCardPaymentTransaction,
} from "./credit-card-payment-reconciliation";
import {
  getFinanceProjectionCardData,
  getReliableCurrentInvoiceSnapshots,
  resolveOpenCardInvoice,
} from "./queries";
import { calculateMonthlyFinancialResult, shiftFinanceMonth } from "./monthly-result";
import { getCommitmentsOverview, getMonthlyFinancialCommitments } from "./commitments-query";
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

function recommendedCloseAt(year: number, month: number) {
  // Cash basis does not wait for the next statement to close. A short window
  // after month-end is enough for the final bank movements to synchronize.
  return new Date(Date.UTC(year, month, 1, 12)).toISOString();
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

  const recommendation = recommendedCloseAt(year, month);
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

function statementPurchaseShares(row: Record<string, unknown>) {
  const purchases = Array.isArray(row.card_purchases)
    ? row.card_purchases as Array<Record<string, unknown>>
    : [];
  return purchases.reduce<{ personal: number; thirdParty: number }>((totals, purchase) => {
    if (purchase.status === "cancelled" || purchase.transaction_role === "refund") return totals;
    const amount = Math.abs(Number(purchase.installment_amount ?? purchase.total_amount ?? 0));
    const instrumentValue = Array.isArray(purchase.credit_card_instruments)
      ? purchase.credit_card_instruments[0]
      : purchase.credit_card_instruments;
    const instrument = instrumentValue && typeof instrumentValue === "object"
      ? instrumentValue as Record<string, unknown>
      : null;
    const assignedToThirdParty = Boolean(instrument?.payment_responsible_person_id);
    const thirdParty = purchase.third_party_share_amount == null
      ? assignedToThirdParty ? amount : 0
      : Math.abs(Number(purchase.third_party_share_amount));
    const personal = purchase.personal_share_amount == null
      ? Math.max(0, amount - thirdParty)
      : Math.abs(Number(purchase.personal_share_amount));
    return { personal: totals.personal + personal, thirdParty: totals.thirdParty + thirdParty };
  }, { personal: 0, thirdParty: 0 });
}

function toStatement(
  row: Record<string, unknown>,
  cardNames: Map<string, string>,
  payments: MonthlyStatementPayment[] = [],
): MonthlyStatement {
  const official = row.pdf_total_amount ??
    row.pluggy_bill_total_amount ??
    row.official_total_amount ??
    (row.total_source === "manual_pdf_confirmation" ? row.manual_invoice_total : null) ??
    row.provider_invoice_total ??
    row.manual_total_amount ??
    row.confirmed_invoice_total;
  const calculated = row.calculated_total_amount ?? row.calculated_invoice_total ?? row.total_amount ?? 0;
  const expected = Number(row.expected_statement_amount ?? official ?? calculated ?? 0);
  const shares = statementPurchaseShares(row);
  const currentOpen = Number(row.current_display_total ?? row.current_open_amount ?? row.confirmed_open_total ?? expected);
  const isOpen = String(row.status) === "open";
  const confirmedPayment = payments.reduce((sum, payment) => sum + payment.allocatedAmount, 0);
  const status = row.payment_confirmation_status
    ? String(row.payment_confirmation_status)
    : calculateStatementPaymentStatus({
        expectedAmount: expected,
        payments,
        statementOpen: String(row.status) === "open",
        cancelled: String(row.status) === "cancelled",
      });
  return {
    id: String(row.id),
    card_id: String(row.card_id),
    card_name: cardNames.get(String(row.card_id)) ?? "Cartão",
    official_total_amount: official == null ? null : Number(official),
    calculated_total_amount: Number(calculated),
    reconciliation_difference: official == null ? null : Number(official) - Number(calculated),
    reconciliation_status: row.reconciliation_status == null ? null : String(row.reconciliation_status),
    official_amount_confirmed: Boolean(row.official_amount_confirmed ?? row.confirmed_invoice_total),
    official_amount_source: row.official_amount_source ? String(row.official_amount_source) : null,
    closing_date: String(row.closing_date),
    due_date: String(row.due_date),
    cycle_start_date: row.statement_period_start ? String(row.statement_period_start) : row.cycle_start_date ? String(row.cycle_start_date) : null,
    cycle_end_date: row.statement_period_end ? String(row.statement_period_end) : row.cycle_end_date ? String(row.cycle_end_date) : null,
    statement_file_path: row.statement_file_path ? String(row.statement_file_path) : null,
    reference_month: row.reference_month ? String(row.reference_month) : null,
    expected_statement_amount: expected,
    current_open_amount: currentOpen,
    detected_payment_amount: Number(row.detected_payment_amount ?? confirmedPayment),
    confirmed_payment_amount: Number(row.confirmed_payment_amount ?? confirmedPayment),
    payment_difference: row.payment_difference == null
      ? Math.round((confirmedPayment - expected) * 100) / 100
      : Number(row.payment_difference),
    payment_confirmation_status: status as MonthlyStatement["payment_confirmation_status"],
    payment_confirmation_source: row.payment_confirmation_source ? String(row.payment_confirmation_source) : null,
    payment_confirmed_at: row.payment_confirmed_at ? String(row.payment_confirmed_at) : null,
    statement_status: String(row.statement_status ?? row.status ?? "estimated"),
    personal_share_amount: isOpen
      ? Math.max(0, currentOpen - shares.thirdParty)
      : Number(row.personal_share_amount ?? Math.max(0, expected - shares.thirdParty)),
    third_party_share_amount: isOpen
      ? shares.thirdParty
      : Number(row.third_party_share_amount ?? shares.thirdParty),
    payments,
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
  const historicalIncomeStart = shiftFinanceMonth(period, -6).startDate;
  const paymentScopeFilter = personalScope && input.ownerId
    ? `workspace_id.eq.${workspaceId},owner_id.eq.${input.ownerId}`
    : `workspace_id.eq.${workspaceId}`;
  const loansQuery = personalScope && input.ownerId
    ? supabase.from("financial_loans").select("id,name,institution_name,outstanding_balance,installment_amount,installments_remaining,next_installment_date,payroll_deducted,status").eq("owner_id", input.ownerId).neq("status", "unavailable")
    : supabase.from("financial_loans").select("id,name,institution_name,outstanding_balance,installment_amount,installments_remaining,next_installment_date,payroll_deducted,status").eq("workspace_id", workspaceId).neq("status", "unavailable");
  const [accountsResult, transactionsResult, historicalIncomeResult, subsequentTransactionsResult, purchasesResult, cardsResult, invoicesResult, statementPaymentsResult, historicalCardPaymentsResult, historicalInvoicesResult, allocationsResult, versionsResult, commitmentMonths, loansResult] = await Promise.all([
    supabase.from("financial_accounts").select("id,name,opening_balance,current_balance,last_sync_at").or(scopeFilter).eq("status", "active"),
    supabase.from("financial_transactions").select("*,financial_accounts:financial_accounts!financial_transactions_account_id_fkey(name,institution_name),credit_cards:credit_cards!financial_transactions_credit_card_id_fkey(name,last_four_digits),financial_categories:financial_categories!financial_transactions_category_id_fkey(name)").or(scopeFilter).or("migrated_card_purchase_id.is.null,transaction_role.eq.invoice_payment,cash_flow_kind.eq.invoice_payment").gte("competence_date", period.startDate).lt("competence_date", period.endExclusiveDate),
    supabase.from("financial_transactions").select("*").or(scopeFilter).or("migrated_card_purchase_id.is.null,transaction_role.eq.invoice_payment,cash_flow_kind.eq.invoice_payment").gte("competence_date", historicalIncomeStart).lt("competence_date", period.startDate),
    supabase.from("financial_transactions").select("*").or(scopeFilter).or("migrated_card_purchase_id.is.null,transaction_role.eq.invoice_payment,cash_flow_kind.eq.invoice_payment").gte("competence_date", period.endExclusiveDate).lte("competence_date", new Date().toISOString().slice(0, 10)),
    supabase.from("card_purchases").select("*,credit_cards:credit_cards!card_purchases_card_id_fkey(name,institution_name,last_four_digits),credit_card_instruments:credit_card_instruments!card_purchases_instrument_id_fkey(display_name,last_four_digits,card_kind,payment_responsible_person_id,default_financial_responsible_id,responsibility_mode),financial_categories:financial_categories!card_purchases_category_id_fkey(name)").or(scopeFilter).or(`and(competence_date.gte.${period.startDate},competence_date.lt.${period.endExclusiveDate}),and(competence_date.is.null,purchase_date.gte.${period.startDate},purchase_date.lt.${period.endExclusiveDate})`),
    supabase.from("credit_cards").select("id,name,last_four_digits,closing_day,due_day,last_sync_at").or(scopeFilter).eq("status", "active"),
    supabase.from("card_invoices").select("*,card_purchases(personal_share_amount,third_party_share_amount,installment_amount,total_amount,transaction_role,status,credit_card_instruments(payment_responsible_person_id))").gte("due_date", shiftFinanceMonth(period, -1).startDate).lt("due_date", shiftFinanceMonth(period, 2).startDate),
    supabase.from("credit_card_statement_payments").select("id,statement_id,bank_transaction_id,allocated_amount,payment_date,payment_source,is_manual,is_third_party,card_invoices!inner(*,card_purchases(personal_share_amount,third_party_share_amount,installment_amount,total_amount,transaction_role,status)),financial_transactions:financial_transactions!credit_card_statement_payments_bank_transaction_id_fkey(description,financial_accounts:financial_accounts!financial_transactions_account_id_fkey(name,institution_name))").or(paymentScopeFilter).gte("payment_date", period.startDate).lt("payment_date", period.endExclusiveDate),
    supabase.from("credit_card_statement_payments").select("allocated_amount,payment_date,bank_transaction_id,is_third_party").or(paymentScopeFilter).gte("payment_date", historicalIncomeStart).lt("payment_date", period.startDate),
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
    ["pagamentos de faturas", statementPaymentsResult],
    ["histórico de pagamentos de faturas", historicalCardPaymentsResult],
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
  const installmentHorizon = shiftFinanceMonth(period, 4).startDate;
  const [commitmentsOverview, installmentPlansResult, installmentOccurrencesResult, peopleResult] = await Promise.all([
    getCommitmentsOverview(supabase, input.ownerId ?? "", { workspaceId, month: period.startDate }),
    supabase.from("card_installment_plans").select("id,description_reference,installment_amount,total_installments,paid_installments,remaining_installments,estimated_last_competence,status").eq("workspace_id", workspaceId).in("status", ["active", "completed"]),
    supabase.from("card_installment_occurrences").select("installment_plan_id,competence_month,installment_number,total_installments,amount,status").eq("workspace_id", workspaceId).gte("competence_month", period.startDate).lt("competence_month", installmentHorizon).neq("status", "cancelled"),
    supabase.from("financial_people").select("id,name").eq("workspace_id", workspaceId).is("archived_at", null),
  ]);
  if (installmentPlansResult.error || installmentOccurrencesResult.error || peopleResult.error) {
    throw new Error("Não foi possível carregar parcelamentos e responsáveis deste mês.");
  }
  const cards = cardsResult.data ?? [];
  const cardIds = new Set(cards.map((card) => String(card.id)));
  const cardNames = new Map(cards.map((card) => [String(card.id), String(card.name)]));
  const invoiceConsumptionReference = shiftFinanceMonth(period, 1).key;
  const monthInvoiceRows = (invoicesResult.data ?? []).filter((row) => {
    if (!cardIds.has(String(row.card_id))) return false;
    return String(row.reference_month ?? "").slice(0, 7) === invoiceConsumptionReference;
  });
  const paymentRows = (statementPaymentsResult.data ?? []).map((row) => {
    const transaction = Array.isArray(row.financial_transactions)
      ? row.financial_transactions[0]
      : row.financial_transactions;
    const account = Array.isArray(transaction?.financial_accounts)
      ? transaction.financial_accounts[0]
      : transaction?.financial_accounts;
    return {
      id: String(row.id),
      statementId: String(row.statement_id),
      statement: (Array.isArray(row.card_invoices) ? row.card_invoices[0] : row.card_invoices) as Record<string, unknown>,
      payment: {
        id: String(row.id),
        bankTransactionId: row.bank_transaction_id ? String(row.bank_transaction_id) : null,
        allocatedAmount: Number(row.allocated_amount),
        paymentDate: String(row.payment_date),
        paymentSource: String(row.payment_source) as MonthlyStatementPayment["paymentSource"],
        isManual: Boolean(row.is_manual),
        isThirdParty: Boolean(row.is_third_party),
        description: transaction?.description ? String(transaction.description) : null,
        accountName: account?.name ? String(account.name) : account?.institution_name ? String(account.institution_name) : null,
      } satisfies MonthlyStatementPayment,
    };
  });
  const paymentsByStatement = new Map<string, MonthlyStatementPayment[]>();
  for (const row of paymentRows) {
    paymentsByStatement.set(row.statementId, [...(paymentsByStatement.get(row.statementId) ?? []), row.payment]);
  }
  const paidInvoiceRows = [...new Map(paymentRows.map(row => [row.statementId, row.statement])).values()];
  const statements = paidInvoiceRows.map(row =>
    toStatement(row, cardNames, paymentsByStatement.get(String(row.id)) ?? []));
  const paidStatementIds = new Set(statements.map(statement => statement.id));
  const reconciliationStatements = (invoicesResult.data ?? [])
    .filter(row => cardIds.has(String(row.card_id)) &&
      !paidStatementIds.has(String(row.id)) &&
      String(row.status) !== "cancelled" &&
      String(row.due_date) >= period.startDate &&
      String(row.due_date) < period.endExclusiveDate)
    .map(row => toStatement(row as Record<string, unknown>, cardNames));
  const openStatementRows = (invoicesResult.data ?? [])
    .filter(row => cardIds.has(String(row.card_id)) &&
      !["cancelled", "paid"].includes(String(row.status)) &&
      String(row.due_date) >= period.endExclusiveDate &&
      String(row.due_date) < shiftFinanceMonth(period, 2).startDate);
  const monthlyPurchases = (purchasesResult.data ?? [])
    .map((row) => resolveMonthlyPurchaseResponsibility(row as MonthlyCardPurchase));
  const peopleNames = new Map((peopleResult.data ?? []).map((person) => [String(person.id), String(person.name)]));
  const purchaseByPlan = new Map(monthlyPurchases.filter((purchase) => purchase.installment_plan_id).map((purchase) => [String(purchase.installment_plan_id), purchase]));
  const occurrencesByPlan = new Map<string, NonNullable<typeof installmentOccurrencesResult.data>>();
  for (const occurrence of installmentOccurrencesResult.data ?? []) {
    const key = String(occurrence.installment_plan_id);
    occurrencesByPlan.set(key, [...(occurrencesByPlan.get(key) ?? []), occurrence]);
  }
  const installments = (installmentPlansResult.data ?? []).flatMap((plan) => {
    const occurrences = occurrencesByPlan.get(String(plan.id)) ?? [];
    const current = occurrences.find((occurrence) => String(occurrence.competence_month).slice(0, 7) === period.key);
    if (!current) return [];
    const purchase = purchaseByPlan.get(String(plan.id));
    const amount = Number(current.amount ?? plan.installment_amount ?? 0);
    const paidInstallments = Number(plan.paid_installments ?? 0);
    const remainingInstallments = Number(plan.remaining_installments ?? Math.max(0, Number(plan.total_installments) - Number(current.installment_number)));
    return [{ id: String(plan.id), description: String(plan.description_reference), current: Number(current.installment_number), total: Number(current.total_installments ?? plan.total_installments), amount, paid: Math.round(amount * paidInstallments * 100) / 100, remaining: Math.round(amount * remainingInstallments * 100) / 100, endsAt: String(plan.estimated_last_competence), responsibleName: purchase?.financial_responsible_id ? peopleNames.get(String(purchase.financial_responsible_id)) ?? null : null }];
  });
  const futureInstallments = [...new Set((installmentOccurrencesResult.data ?? []).map((occurrence) => String(occurrence.competence_month).slice(0, 7)))].filter((key) => key > period.key).map((key) => ({ month: key, amount: (installmentOccurrencesResult.data ?? []).filter((occurrence) => String(occurrence.competence_month).slice(0, 7) === key).reduce((sum, occurrence) => sum + Number(occurrence.amount ?? 0), 0) }));
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
  const incomeMonthlyTotals = Array.from({ length: 6 }, (_, index) =>
    shiftFinanceMonth(period, index - 6)).flatMap((historicalPeriod) => {
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
    maximumMonths: 6,
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
  const invoiceAnalytics = buildInvoiceHistoryAnalytics(historicalInvoiceEntries, forecastCardInvoice, 6);
  const historicalCardCashByMonth = new Map<string, number>();
  for (const payment of historicalCardPaymentsResult.data ?? []) {
    if (!payment.bank_transaction_id || payment.is_third_party) continue;
    const key = String(payment.payment_date).slice(0, 7);
    historicalCardCashByMonth.set(key,
      (historicalCardCashByMonth.get(key) ?? 0) + Number(payment.allocated_amount ?? 0));
  }
  const historicalCardCashTotals = [...historicalCardCashByMonth.values()].sort((left, right) => left - right);
  const historicalCardCashMedian = historicalCardCashTotals.length
    ? historicalCardCashTotals.length % 2
      ? historicalCardCashTotals[Math.floor(historicalCardCashTotals.length / 2)]
      : (historicalCardCashTotals[historicalCardCashTotals.length / 2 - 1] +
        historicalCardCashTotals[historicalCardCashTotals.length / 2]) / 2
    : null;
  const futureCommitmentMonths = commitmentMonths.slice(0, 3).map((item) => ({
    month: item.competenceMonth.slice(0, 7),
    // Installments already belong to the open statement forecast and must not
    // be counted again in the next-income commitment.
    amount: Math.max(0, item.totalCommittedCents - item.installmentTotalCents) / 100,
    }));
  const resolvedOpenInvoices = await Promise.all(openStatementRows.map(row =>
    resolveOpenCardInvoice(supabase, input.ownerId ?? "", {
      workspaceId: personalScope ? null : workspaceId,
      cycleId: String(row.id),
      referenceDate: row.due_date ? String(row.due_date) : period.endExclusiveDate,
    })));
  const openStatements = openStatementRows.map((row, index) => {
    const statement = toStatement(row as Record<string, unknown>, cardNames);
    const resolved = resolvedOpenInvoices[index];
    if (resolved?.displayTotal == null) return statement;
    return {
      ...statement,
      current_open_amount: resolved.displayTotal,
      personal_share_amount: Math.max(
        0,resolved.displayTotal-statement.third_party_share_amount,
      ),
    };
  });
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
  const allocatedBankTransactions = new Set(paymentRows
    .map(row => row.payment.bankTransactionId)
    .filter((id): id is string => Boolean(id)));
  const paymentCandidates = ((transactionsResult.data ?? []) as FinancialTransaction[])
    .flatMap(transaction => {
      const identified = identifyCreditCardPaymentTransaction(transaction);
      if (!identified.isCandidate || allocatedBankTransactions.has(transaction.id)) return [];
      return [{ id: transaction.id, description: transaction.description,
        amount: identified.amount, paymentDate: identified.paymentDate ?? transaction.competence_date,
        creditCardId: transaction.credit_card_id ?? null,
        confidence: identified.confidence }];
    });
  const unmatchedPaymentCount = paymentCandidates.length;
  const unmatchedCardPayments: MonthlyStatementPayment[] = paymentCandidates.map(candidate => ({
    id: `candidate-${candidate.id}`,
    bankTransactionId: candidate.id,
    allocatedAmount: candidate.amount,
    paymentDate: candidate.paymentDate,
    paymentSource: "bank_transaction",
    isManual: false,
    isThirdParty: false,
    description: candidate.description,
  }));
  const liveSnapshot = buildMonthlySnapshot({
    period,
    transactions: (transactionsResult.data ?? []) as FinancialTransaction[],
    subsequentTransactions: (subsequentTransactionsResult.data ?? []) as FinancialTransaction[],
    purchases: monthlyPurchases,
    statements,
    openStatements,
    unmatchedPaymentCount,
    unmatchedCardPayments,
    allocations,
    accounts,
    forecastCardInvoice,
    incomeHistoricalReference: {
      median: financialMonth.is_first_financial_report || incomeStatistics.medianAmount == null
        ? null
        : incomeStatistics.medianAmount / 100,
      months: financialMonth.is_first_financial_report ? 0 : incomeStatistics.monthsAvailable,
    },
    cardInvoiceHistoricalReference: {
      median: financialMonth.is_first_financial_report
        ? null
        : historicalCardCashMedian ?? invoiceAnalytics.median,
      months: financialMonth.is_first_financial_report
        ? 0
        : historicalCardCashTotals.length || invoiceAnalytics.months.length,
    },
    futureCommitmentMonths,
    recurringGroups: mergeDependentCostsIntoRecurringGroups(
      commitmentsOverview.recurring.groups.map((group) => ({ name: group.contextName, type: group.groupType, total: group.total / 100, items: group.items.filter((item) => item.status !== "paused").map((item) => ({ name: item.title, amount: item.amountCents / 100 })) })),
      commitmentsOverview.people.map(person => ({
        name: person.person.name,
        isDependent: person.person.isDependent,
        actualSpentCents: person.breakdown.actualSpentCents,
        projectedCommitmentsCents: person.breakdown.projectedCommitmentsCents,
      })),
    ),
    installments,
    futureInstallments,
    futureCommitments: futureCommitmentMonths[0]?.amount ?? 0,
    loans,
    scope: calculationScope,
    status,
    accountsSyncHealthy: true,
    expectedStatementCount: cards.length,
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
    reconciliationStatements,
    openStatements,
    paymentCandidates,
    versions,
    people: peopleResult.data ?? [],
    schemaReady: !financialMonth.id.startsWith("pending-"),
  };
}
