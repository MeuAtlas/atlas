import type { SupabaseClient } from "@supabase/supabase-js";
import {
  type IncomeExpenseOverview,
  type IncomeHistoricalStatistics,
} from "./income-expenses";
import {
  calculateFinancialImpactSummary,
  resolveCommitmentFinancialEffects,
  type AnalyticsEffect,
  type CashFlowEffect,
  type ExpensePaymentChannel,
  type IncomeBasis,
  type PlanningEffect,
} from "./financial-impact";
import {
  getIncomeExpenseDashboard,
  type IncomeExpenseDashboard,
} from "./income-expense-dashboard";

export type IncomeExpenseListItem = {
  id: string;
  occurrenceId: string | null;
  categoryId: string | null;
  accountId: string | null;
  cardId: string | null;
  personId: string | null;
  title: string;
  description: string | null;
  merchantMatchPattern?: string | null;
  amountType?: "fixed" | "variable" | "estimated";
  direction: "income" | "expense";
  recurrenceFrequency: string;
  expectedDateDay: number | null;
  estimationMethod: "fixed" | "historical_median" | "manual";
  aggregationMode: "single_occurrence" | "monthly_total";
  contextType: "personal" | "household" | "work" | "travel";
  budgetPriority?: "essential" | "adjustable" | "optional" | "unknown";
  status: string;
  expectedAmountCents: number;
  realizedAmountCents: number;
  differenceCents: number;
  occurrenceStatus: string;
  competenceMonth: string;
  expectedDate: string | null;
  paymentDate: string | null;
  paymentMethod: string | null;
  paymentSourceName: string | null;
  settlementSource: string | null;
  linkedInvoiceId: string | null;
  linkedTransactionId: string | null;
  creditsCount: number;
  historicalMedianCents: number | null;
  historicalAverageCents: number | null;
  historicalMonthsCount: number;
  incomeBasis: IncomeBasis | null;
  cashFlowEffect: CashFlowEffect;
  planningEffect: PlanningEffect;
  analyticsEffect: AnalyticsEffect;
  paymentChannel: ExpensePaymentChannel;
  isPayrollDeduction: boolean;
  categoryName: string | null;
  personNames: string[];
};

export type IncomeExpensePageData = {
  workspaceId: string;
  month: string;
  overview: IncomeExpenseOverview;
  incomes: IncomeExpenseListItem[];
  expenses: IncomeExpenseListItem[];
  payrollDeductions: IncomeExpenseListItem[];
  upcoming: IncomeExpenseListItem[];
  dashboard: IncomeExpenseDashboard;
};

const cents = (value: unknown) =>
  Math.round(Math.abs(Number(value ?? 0)) * 100);

type CommitmentRow = {
  id: string;
  title: string;
  description: string | null;
  merchant_match_pattern: string | null;
  cash_flow_direction: string | null;
  recurrence_frequency: string | null;
  estimation_method: string | null;
  aggregation_mode: string | null;
  context_type: string | null;
  budget_priority: string | null;
  status: string;
  expected_amount: number | null;
  amount_type: string | null;
  historical_median_amount: number | null;
  historical_average_amount: number | null;
  historical_months_count: number | null;
  commitment_type: string | null;
  payment_method: string | null;
  category_id: string | null;
  account_id: string | null;
  card_id: string | null;
  expected_date_day: number | null;
  is_payroll_deduction: boolean | null;
  income_basis: IncomeBasis | null;
  cash_flow_effect: CashFlowEffect | null;
  planning_effect: PlanningEffect | null;
  analytics_effect: AnalyticsEffect | null;
  payment_channel: ExpensePaymentChannel | null;
  financial_categories: { name: string } | null;
  financial_accounts: {
    name: string;
    institution_name: string | null;
  } | null;
  credit_cards: {
    name: string;
    last_four_digits: string | null;
  } | null;
  commitment_people: Array<{
    person_id: string;
    is_primary: boolean;
    financial_people: { name: string } | null;
  }> | null;
};

type OccurrenceRow = {
  id: string;
  commitment_id: string;
  competence_month: string;
  expected_due_date: string | null;
  expected_amount: number | null;
  actual_amount: number | null;
  received_amount: number | null;
  paid_amount: number | null;
  payment_date: string | null;
  linked_transaction_id: string | null;
  linked_invoice_id: string | null;
  match_source: string | null;
  linked_transactions_count: number | null;
  status: string;
};

type LinkedTransactionRow = {
  id: string;
  financial_accounts: {
    name: string;
    institution_name: string | null;
  } | null;
  credit_cards: {
    name: string;
    last_four_digits: string | null;
  } | null;
};

const accountLabel = (
  account: CommitmentRow["financial_accounts"] | null | undefined,
) => account
  ? [account.name, account.institution_name].filter(Boolean).join(" · ")
  : null;

const cardLabel = (
  card: CommitmentRow["credit_cards"] | null | undefined,
) => card
  ? `${card.name}${card.last_four_digits ? ` · final ${card.last_four_digits}` : ""}`
  : null;

export async function getIncomeExpenseOverview(
  supabase: SupabaseClient,
  input: { workspaceId: string; month: string },
): Promise<IncomeExpensePageData> {
  const month = `${input.month.slice(0, 7)}-01`;
  const [commitments, occurrences] = await Promise.all([
    supabase.from("financial_commitments").select(
      [
        "id",
        "title",
        "description",
        "merchant_match_pattern",
        "cash_flow_direction",
        "recurrence_frequency",
        "estimation_method",
        "aggregation_mode",
        "context_type",
        "budget_priority",
        "status",
        "expected_amount",
        "amount_type",
        "historical_median_amount",
        "historical_average_amount",
        "historical_months_count",
        "commitment_type",
        "payment_method",
        "category_id",
        "account_id",
        "card_id",
        "expected_date_day",
        "is_payroll_deduction",
        "income_basis",
        "cash_flow_effect",
        "planning_effect",
        "analytics_effect",
        "payment_channel",
        "financial_categories(name)",
        "financial_accounts(name,institution_name)",
        "credit_cards(name,last_four_digits)",
        "commitment_people(person_id,is_primary,financial_people(name))",
      ].join(","),
    ).eq("workspace_id", input.workspaceId)
      .is("archived_at", null)
      .neq("status", "archived")
      .order("title"),
    supabase.from("financial_commitment_occurrences").select(
      [
        "id",
        "commitment_id",
        "competence_month",
        "expected_due_date",
        "expected_amount",
        "actual_amount",
        "received_amount",
        "paid_amount",
        "payment_date",
        "linked_transaction_id",
        "linked_invoice_id",
        "match_source",
        "linked_transactions_count",
        "status",
      ].join(","),
    ).eq("workspace_id", input.workspaceId)
      .eq("competence_month", month),
  ]);
  if (commitments.error || occurrences.error) {
    throw new Error("Não foi possível carregar Receitas e Despesas.");
  }
  const occurrenceRows = (occurrences.data ?? []) as unknown as OccurrenceRow[];
  const commitmentRows = (commitments.data ?? []) as unknown as CommitmentRow[];
  const linkedTransactionIds = occurrenceRows
    .map(row => row.linked_transaction_id)
    .filter((id): id is string => Boolean(id));
  const linkedTransactions = linkedTransactionIds.length
    ? await supabase.from("financial_transactions").select(
      [
        "id",
        "financial_accounts:financial_accounts!financial_transactions_account_id_fkey(name,institution_name)",
        "credit_cards:credit_cards!financial_transactions_credit_card_id_fkey(name,last_four_digits)",
      ].join(","),
    ).in("id", linkedTransactionIds)
    : { data: [], error: null };
  if (linkedTransactions.error) {
    throw new Error("NÃ£o foi possÃ­vel carregar a origem dos pagamentos.");
  }
  const linkedTransactionById = new Map(
    ((linkedTransactions.data ?? []) as unknown as LinkedTransactionRow[])
      .map(row => [String(row.id), row]),
  );
  const occurrenceByCommitment = new Map<string, OccurrenceRow>(
    occurrenceRows.map(row => [String(row.commitment_id), row]),
  );
  const items: IncomeExpenseListItem[] = commitmentRows.map(row => {
    const occurrence = occurrenceByCommitment.get(String(row.id));
    const direction = row.cash_flow_direction === "income"
      ? "income" as const
      : "expense" as const;
    const effects = resolveCommitmentFinancialEffects({
      direction,
      commitmentType: row.commitment_type,
      paymentMethod: row.payment_method,
      isPayrollDeduction: row.is_payroll_deduction,
      incomeBasis: row.income_basis,
      cashFlowEffect: row.cash_flow_effect,
      planningEffect: row.planning_effect,
      analyticsEffect: row.analytics_effect,
      paymentChannel: row.payment_channel,
    });
    const expectedAmountCents = cents(
      occurrence?.expected_amount ?? row.expected_amount,
    );
    const recordedAmountCents = direction === "income"
      ? cents(occurrence?.received_amount ?? occurrence?.actual_amount)
      : cents(occurrence?.paid_amount ?? occurrence?.actual_amount);
    // Payroll deductions are settled by the employer directly in the payroll.
    // They are never pending bank debits for the person.
    const realizedAmountCents = effects.isPayrollDeduction
      ? expectedAmountCents
      : recordedAmountCents;
    const amountType = String(row.amount_type ?? "fixed") as
      IncomeExpenseListItem["amountType"];
    const occurrenceStatus = effects.isPayrollDeduction
      ? "paid"
      : String(occurrence?.status ?? "projected");
    const linkedTransaction = occurrence?.linked_transaction_id
      ? linkedTransactionById.get(occurrence.linked_transaction_id)
      : null;
    const paymentSourceName = cardLabel(linkedTransaction?.credit_cards)
      ?? accountLabel(linkedTransaction?.financial_accounts)
      ?? cardLabel(row.credit_cards)
      ?? accountLabel(row.financial_accounts);
    return {
      id: String(row.id),
      occurrenceId: occurrence?.id ? String(occurrence.id) : null,
      categoryId: row.category_id ? String(row.category_id) : null,
      accountId: row.account_id ? String(row.account_id) : null,
      cardId: row.card_id ? String(row.card_id) : null,
      personId: row.commitment_people?.find(person => person.is_primary)
        ?.person_id ?? row.commitment_people?.[0]?.person_id ?? null,
      title: String(row.title),
      description: row.description ? String(row.description) : null,
      merchantMatchPattern: row.merchant_match_pattern
        ? String(row.merchant_match_pattern)
        : null,
      direction,
      recurrenceFrequency: String(row.recurrence_frequency ?? "none"),
      expectedDateDay: row.expected_date_day == null
        ? null
        : Number(row.expected_date_day),
      estimationMethod: String(row.estimation_method ?? "fixed") as
        IncomeExpenseListItem["estimationMethod"],
      aggregationMode: String(row.aggregation_mode ?? "single_occurrence") as
        IncomeExpenseListItem["aggregationMode"],
      contextType: String(row.context_type ?? "personal") as
        IncomeExpenseListItem["contextType"],
      budgetPriority: String(row.budget_priority ?? "unknown") as
        IncomeExpenseListItem["budgetPriority"],
      status: String(row.status),
      expectedAmountCents,
      amountType,
      realizedAmountCents,
      differenceCents: realizedAmountCents - expectedAmountCents,
      occurrenceStatus,
      competenceMonth: String(occurrence?.competence_month ?? month),
      expectedDate: occurrence?.expected_due_date
        ? String(occurrence.expected_due_date)
        : null,
      paymentDate: occurrence?.payment_date
        ? String(occurrence.payment_date)
        : null,
      paymentMethod: row.payment_method
        ? String(row.payment_method)
        : null,
      paymentSourceName,
      settlementSource: occurrence?.match_source
        ? String(occurrence.match_source)
        : null,
      linkedInvoiceId: occurrence?.linked_invoice_id
        ? String(occurrence.linked_invoice_id)
        : null,
      linkedTransactionId: occurrence?.linked_transaction_id
        ? String(occurrence.linked_transaction_id)
        : null,
      creditsCount: Number(occurrence?.linked_transactions_count ?? 0),
      historicalMedianCents: row.historical_median_amount == null
        ? null
        : cents(row.historical_median_amount),
      historicalAverageCents: row.historical_average_amount == null
        ? null
        : cents(row.historical_average_amount),
      historicalMonthsCount: Number(row.historical_months_count ?? 0),
      ...effects,
      categoryName: row.financial_categories?.name ?? null,
      personNames: (row.commitment_people ?? [])
        .map(item => item.financial_people?.name)
        .filter((name): name is string => Boolean(name)),
    };
  });
  const incomes = items.filter(item => item.direction === "income");
  const allExpenses = items.filter(item => item.direction === "expense");
  const cashExpenses = allExpenses.filter(item => !item.isPayrollDeduction);
  // The Expenses tab lists every registered expense. Payroll deductions are
  // excluded only from cash totals, so the salary is never counted twice.
  const expenses = allExpenses;
  const impact = calculateFinancialImpactSummary(items.map(item => ({
    incomeBasis: item.incomeBasis,
    cashFlowEffect: item.cashFlowEffect,
    planningEffect: item.planningEffect,
    analyticsEffect: item.analyticsEffect,
    paymentChannel: item.paymentChannel,
    isPayrollDeduction: item.isPayrollDeduction,
    expectedCents: item.expectedAmountCents,
    realizedCents: item.realizedAmountCents,
    status: item.occurrenceStatus,
  })));
  const overview: IncomeExpenseOverview = {
    expectedIncomeCents: impact.netIncomeExpected,
    receivedIncomeCents: impact.netIncomeReceived,
    expectedExpenseCents: impact.cashExpensesExpected,
    paidExpenseCents: impact.cashExpensesRealized,
    projectedBalanceCents: impact.projectedAvailable,
    realizedBalanceCents: impact.realizedAvailable,
  };
  const payrollDeductions = allExpenses.filter(item => item.isPayrollDeduction);
  return {
    workspaceId: input.workspaceId,
    month,
    overview,
    incomes,
    expenses,
    payrollDeductions,
    upcoming: items
      .filter(item =>
        !item.isPayrollDeduction &&
        !["paid", "received", "cancelled", "skipped"].includes(
          item.occurrenceStatus,
        )
      )
      .sort((left, right) =>
        (left.expectedDate ?? "9999").localeCompare(
          right.expectedDate ?? "9999",
        )
      ),
    dashboard: getIncomeExpenseDashboard({
      month,
      incomes,
      expenses: cashExpenses,
      payrollDeductions,
    }),
  };
}

export function incomeStatisticsFromItem(
  item: IncomeExpenseListItem,
): IncomeHistoricalStatistics | null {
  if (item.historicalMedianCents === null) return null;
  return {
    monthlyTotals: [],
    medianAmount: item.historicalMedianCents,
    averageAmount: item.historicalAverageCents,
    monthsAvailable: item.historicalMonthsCount,
    monthsWithIncome: item.historicalMonthsCount,
    monthsWithZero: 0,
    coverageMonths: item.historicalMonthsCount,
    confidence: item.historicalMonthsCount >= 9
      ? "high"
      : item.historicalMonthsCount >= 3
        ? "medium"
        : "low",
    firstMonth: null,
    lastMonth: null,
    totalCredits: 0,
    warning: item.historicalMonthsCount < 3
      ? "Há pouco histórico disponível."
      : null,
  };
}

export const getIncomeOverview = getIncomeExpenseOverview;

export async function getIncomeMonthlyTrend(
  supabase: SupabaseClient,
  input: { workspaceId: string; incomeId: string; maximumMonths?: number },
) {
  const limit = Math.min(12, Math.max(1, input.maximumMonths ?? 12));
  const result = await supabase
    .from("financial_commitment_occurrences")
    .select(
      "id,competence_month,expected_amount,received_amount,linked_transactions_count,status",
    )
    .eq("workspace_id", input.workspaceId)
    .eq("commitment_id", input.incomeId)
    .order("competence_month", { ascending: false })
    .limit(limit);
  if (result.error) {
    throw new Error("Não foi possível carregar a evolução mensal da receita.");
  }
  type TrendRow = {
    id: string;
    competence_month: string;
    expected_amount: number | null;
    received_amount: number | null;
    linked_transactions_count: number | null;
    status: string;
  };
  return ((result.data ?? []) as unknown as TrendRow[]).reverse().map(row => ({
    id: row.id,
    month: row.competence_month,
    expectedAmountCents: cents(row.expected_amount),
    receivedAmountCents: cents(row.received_amount),
    creditsCount: Number(row.linked_transactions_count ?? 0),
    status: row.status,
  }));
}

export async function getIncomeHistoricalStatistics(
  supabase: SupabaseClient,
  input: { workspaceId: string; incomeId: string },
): Promise<IncomeHistoricalStatistics | null> {
  const definition = await supabase.from("financial_commitments")
    .select(
      "id,historical_median_amount,historical_average_amount,historical_months_count",
    )
    .eq("workspace_id", input.workspaceId)
    .eq("id", input.incomeId)
    .eq("cash_flow_direction", "income")
    .single();
  if (definition.error || !definition.data) return null;
  const trend = await getIncomeMonthlyTrend(supabase, {
    workspaceId: input.workspaceId,
    incomeId: input.incomeId,
  });
  const months = Number(definition.data.historical_months_count ?? 0);
  return {
    monthlyTotals: trend.map(item => ({
      month: item.month,
      totalCents: item.receivedAmountCents,
      creditsCount: item.creditsCount,
      hasCoverage: item.creditsCount > 0,
      isComplete: true,
    })),
    medianAmount: definition.data.historical_median_amount == null
      ? null
      : cents(definition.data.historical_median_amount),
    averageAmount: definition.data.historical_average_amount == null
      ? null
      : cents(definition.data.historical_average_amount),
    monthsAvailable: months,
    monthsWithIncome: trend.filter(item => item.receivedAmountCents > 0).length,
    monthsWithZero: trend.filter(item => item.receivedAmountCents === 0).length,
    coverageMonths: months,
    confidence: months >= 9 ? "high" : months >= 3 ? "medium" : "low",
    firstMonth: trend[0]?.month ?? null,
    lastMonth: trend.at(-1)?.month ?? null,
    totalCredits: trend.reduce((sum, item) => sum + item.creditsCount, 0),
    warning: months < 3 ? "Há pouco histórico disponível." : null,
  };
}

export async function getIncomeReferenceTransactions(
  supabase: SupabaseClient,
  input: {
    workspaceId: string;
    userId: string;
    from: string;
    limit?: number;
  },
) {
  const result = await supabase.from("financial_transactions")
    .select(
      "id,description,amount,competence_date,workspace_id,owner_id,financial_accounts:financial_accounts!financial_transactions_account_id_fkey(name,institution_name)",
    )
    .eq("owner_id", input.userId)
    .gte("competence_date", input.from)
    .or("bank_direction.eq.inflow,transaction_type.eq.income")
    .order("competence_date", { ascending: false })
    .limit(Math.min(200, Math.max(1, input.limit ?? 200)));
  if (result.error) {
    throw new Error("Não foi possível carregar as entradas bancárias.");
  }
  type ReferenceRow = {
    id: string;
    description: string;
    amount: number | string;
    competence_date: string;
    workspace_id: string | null;
    owner_id: string;
    financial_accounts:
      | { name: string; institution_name: string | null }
      | Array<{ name: string; institution_name: string | null }>
      | null;
  };
  return ((result.data ?? []) as unknown as ReferenceRow[])
    .filter(row =>
      row.workspace_id === input.workspaceId ||
      (row.workspace_id === null && row.owner_id === input.userId)
    )
    .map(row => {
      const account = Array.isArray(row.financial_accounts)
        ? row.financial_accounts[0]
        : row.financial_accounts;
      return {
        id: row.id,
        description: row.description,
        amountCents: cents(row.amount),
        date: row.competence_date,
        accountName: [account?.institution_name, account?.name]
          .filter(Boolean).join(" · ") || "Conta bancária",
      };
    });
}
