import type { SupabaseClient } from "@supabase/supabase-js";
import { throwSupabaseError } from "@/lib/errors";
import {
  allocatedAmountCents,
  buildMonthlyCommitmentProjections,
  moneyToCents,
  resolveMonthlyCommitmentTotals,
  updateOccurrenceStatuses,
  type CommitmentOccurrence,
  type CommitmentPersonAllocation,
  type FinancialCommitment,
  type FinancialPerson,
  type MonthlyCommitmentProjection,
  type PersonFinancialBreakdown,
  type PersonFinancialSummary,
} from "./commitments";
import {
  getRecurringCommitmentsOverview,
  type RecurringCommitmentsOverview,
} from "./recurring-commitments-overview";
import { resolveCommitmentFinancialEffects } from "./financial-impact";

type CommitmentRow = {
  id: string;
  workspace_id: string;
  title: string;
  description: string | null;
  commitment_type: FinancialCommitment["commitmentType"];
  recurrence_frequency: FinancialCommitment["recurrenceFrequency"];
  recurrence_interval: number | null;
  amount_type: FinancialCommitment["amountType"];
  expected_amount: number | string | null;
  minimum_expected_amount: number | string | null;
  maximum_expected_amount: number | string | null;
  currency_code: string;
  category_id: string | null;
  account_id: string | null;
  card_id: string | null;
  payment_method: string | null;
  due_day: number | null;
  due_date: string | null;
  start_date: string;
  end_date: string | null;
  next_due_date: string | null;
  status: FinancialCommitment["status"];
  auto_match_enabled: boolean;
  merchant_match_pattern: string | null;
  description_match_pattern: string | null;
  expected_day_tolerance: number;
  expected_amount_tolerance: number | string | null;
  source: string;
  source_record_id: string | null;
  is_payroll_deduction: boolean;
  generates_future_projections: boolean;
  last_generated_until: string | null;
  cash_flow_direction?: "expense" | "income" | null;
  include_in_monthly_budget?: boolean | null;
  same_invoice?: boolean | null;
  tags?: string[] | null;
  shared_expense_enabled?: boolean | null;
  beneficiary_person_id?: string | null;
  user_responsibility_type?: FinancialCommitment["userResponsibilityType"];
  user_responsibility_value?: number | string | null;
  reimbursement_person_id?: string | null;
  reimbursement_allocation_type?:
    FinancialCommitment["reimbursementAllocationType"];
  reimbursement_allocation_value?: number | string | null;
  analysis_group_id?: string | null;
  context_type?: FinancialCommitment["contextType"] | null;
  budget_priority?: FinancialCommitment["budgetPriority"] | null;
  natural_language_source?: string | null;
  notes?: string | null;
  income_basis?: FinancialCommitment["incomeBasis"];
  cash_flow_effect?: FinancialCommitment["cashFlowEffect"] | null;
  planning_effect?: FinancialCommitment["planningEffect"] | null;
  analytics_effect?: FinancialCommitment["analyticsEffect"] | null;
  payment_channel?: FinancialCommitment["paymentChannel"] | null;
  financial_categories?: { name: string } | null;
  financial_accounts?: { name: string } | null;
  credit_cards?: { name: string; last_four_digits: string | null } | null;
  financial_analysis_groups?: {
    id: string;
    name: string;
    group_type: string;
  } | Array<{
    id: string;
    name: string;
    group_type: string;
  }> | null;
};

type OccurrenceRow = {
  id: string;
  commitment_id: string;
  competence_month: string;
  sequence_number: number;
  expected_due_date: string | null;
  expected_amount: number | string | null;
  actual_amount: number | string | null;
  status: CommitmentOccurrence["status"];
  payment_date: string | null;
  linked_transaction_id: string | null;
  linked_card_movement_id: string | null;
  match_confidence: number | null;
  match_source: string | null;
  manually_confirmed: boolean;
};

export type CommitmentListItem = {
  commitment: FinancialCommitment;
  categoryName: string | null;
  accountName: string | null;
  cardName: string | null;
  people: Array<{ id: string; name: string; isDependent: boolean }>;
  currentOccurrence: CommitmentOccurrence | null;
  nextOccurrence: CommitmentOccurrence | null;
  futureOccurrence: CommitmentOccurrence | null;
  history: Array<{
    id: string;
    eventType: string;
    summary: string;
    createdAt: string;
  }>;
};

export type CommitmentsOverview = {
  workspaceId: string;
  month: string;
  totals: {
    committedCents: number;
    paidCents: number;
    pendingCents: number;
    overdueCents: number;
    next30DaysCents: number;
    recurringMonthlyCents: number;
    dependentCents: number;
    primaryCategoryName: string | null;
    primaryCategoryCents: number;
  };
  commitments: CommitmentListItem[];
  people: Array<{
    person: FinancialPerson;
    breakdown: PersonFinancialBreakdown;
    nextCommitment: string | null;
  }>;
  occurrences: CommitmentOccurrence[];
  alerts: string[];
  recurring: RecurringCommitmentsOverview;
};

export const mapCommitment = (row: CommitmentRow): FinancialCommitment => {
  const analysisGroup = Array.isArray(row.financial_analysis_groups)
    ? row.financial_analysis_groups[0] ?? null
    : row.financial_analysis_groups ?? null;
  const effects = resolveCommitmentFinancialEffects({
    direction: row.cash_flow_direction,
    commitmentType: row.commitment_type,
    paymentMethod: row.payment_method,
    isPayrollDeduction: row.is_payroll_deduction,
    incomeBasis: row.income_basis,
    cashFlowEffect: row.cash_flow_effect,
    planningEffect: row.planning_effect,
    analyticsEffect: row.analytics_effect,
    paymentChannel: row.payment_channel,
  });
  return ({
  id: row.id,
  workspaceId: row.workspace_id,
  title: row.title,
  description: row.description,
  commitmentType: row.commitment_type,
  recurrenceFrequency: row.recurrence_frequency,
  recurrenceInterval: row.recurrence_interval,
  amountType: row.amount_type,
  expectedAmountCents: moneyToCents(row.expected_amount),
  minimumExpectedAmountCents: moneyToCents(row.minimum_expected_amount),
  maximumExpectedAmountCents: moneyToCents(row.maximum_expected_amount),
  currencyCode: row.currency_code,
  categoryId: row.category_id,
  accountId: row.account_id,
  cardId: row.card_id,
  paymentMethod: row.payment_method,
  dueDay: row.due_day,
  dueDate: row.due_date,
  startDate: row.start_date,
  endDate: row.end_date,
  nextDueDate: row.next_due_date,
  status: row.status,
  autoMatchEnabled: row.auto_match_enabled,
  merchantMatchPattern: row.merchant_match_pattern,
  descriptionMatchPattern: row.description_match_pattern,
  expectedDayTolerance: row.expected_day_tolerance,
  expectedAmountToleranceCents: moneyToCents(row.expected_amount_tolerance),
  source: row.source,
  sourceRecordId: row.source_record_id,
  generatesFutureProjections: row.generates_future_projections,
  lastGeneratedUntil: row.last_generated_until,
  cashFlowDirection: row.cash_flow_direction ?? "expense",
  includeInMonthlyBudget: row.include_in_monthly_budget ?? true,
  sameInvoice: row.same_invoice ?? false,
  tags: Array.isArray(row.tags) ? row.tags : [],
  sharedExpenseEnabled: row.shared_expense_enabled ?? false,
  beneficiaryPersonId: row.beneficiary_person_id ?? null,
  userResponsibilityType: row.user_responsibility_type ?? null,
  userResponsibilityValue: row.user_responsibility_value == null
    ? null : Number(row.user_responsibility_value),
  reimbursementPersonId: row.reimbursement_person_id ?? null,
  reimbursementAllocationType: row.reimbursement_allocation_type ?? null,
  reimbursementAllocationValue: row.reimbursement_allocation_value == null
    ? null : Number(row.reimbursement_allocation_value),
  analysisGroupId: row.analysis_group_id ?? null,
  analysisGroupName: analysisGroup?.name ?? null,
  analysisGroupType: analysisGroup?.group_type ?? null,
  contextType: row.context_type ?? "personal",
  budgetPriority: row.budget_priority ?? "unknown",
  naturalLanguageSource: row.natural_language_source ?? null,
  notes: row.notes ?? null,
  ...effects,
  });
};

export const mapOccurrence = (row: OccurrenceRow): CommitmentOccurrence => ({
  id: row.id,
  commitmentId: row.commitment_id,
  competenceMonth: row.competence_month,
  sequenceNumber: row.sequence_number,
  expectedDueDate: row.expected_due_date,
  expectedAmountCents: moneyToCents(row.expected_amount),
  actualAmountCents: moneyToCents(row.actual_amount),
  status: row.status,
  paymentDate: row.payment_date,
  linkedTransactionId: row.linked_transaction_id,
  linkedCardMovementId: row.linked_card_movement_id,
  matchConfidence: row.match_confidence,
  matchSource: row.match_source,
  manuallyConfirmed: row.manually_confirmed,
});

export async function refreshOccurrenceStatuses(
  supabase: SupabaseClient,
  workspaceId: string,
  today = new Date().toISOString().slice(0, 10),
) {
  const result = await supabase.from("financial_commitment_occurrences")
    .select("*").eq("workspace_id", workspaceId)
    .in("status", ["projected", "expected", "pending", "overdue", "partially_paid"]);
  if (result.error) {
    throwSupabaseError(
      result.error,
      "refreshOccurrenceStatuses.read",
      "Não foi possível verificar os vencimentos.",
    );
  }
  const current = (result.data ?? []).map(row =>
    mapOccurrence(row as unknown as OccurrenceRow)
  );
  const resolved = updateOccurrenceStatuses(current, today);
  const changed = resolved.filter((item, index) =>
    item.status !== current[index].status
  );
  for (const occurrence of changed) {
    const update = await supabase.from("financial_commitment_occurrences")
      .update({ status: occurrence.status }).eq("workspace_id", workspaceId)
      .eq("id", occurrence.id);
    if (update.error) {
      throwSupabaseError(
        update.error,
        "refreshOccurrenceStatuses.write",
        "Não foi possível atualizar os vencimentos.",
      );
    }
  }
  return changed.length;
}

export async function getCommitmentsOverview(
  supabase: SupabaseClient,
  _userId: string,
  input: { workspaceId: string; month: string },
): Promise<CommitmentsOverview> {
  const month = `${input.month.slice(0, 7)}-01`;
  const next30 = new Date();
  next30.setUTCDate(next30.getUTCDate() + 30);
  const next30Date = next30.toISOString().slice(0, 10);
  const horizon = new Date(`${month}T12:00:00Z`);
  horizon.setUTCMonth(horizon.getUTCMonth() + 12);
  const horizonMonth = horizon.toISOString().slice(0, 7) + "-01";
  const nextMonthDate = new Date(`${month}T12:00:00Z`);
  nextMonthDate.setUTCMonth(nextMonthDate.getUTCMonth() + 1);
  const nextMonth = nextMonthDate.toISOString().slice(0, 7) + "-01";
  const [
    commitmentsResult,
    occurrencesResult,
    peopleResult,
    allocationsResult,
    transactionPeopleResult,
    historyResult,
  ] =
    await Promise.all([
      supabase.from("financial_commitments").select(
        "*,financial_categories(name),financial_accounts(name),credit_cards(name,last_four_digits),financial_analysis_groups(id,name,group_type)",
      ).eq("workspace_id", input.workspaceId).is("archived_at", null)
        .order("next_due_date", { ascending: true }),
      supabase.from("financial_commitment_occurrences").select("*")
        .eq("workspace_id", input.workspaceId)
        .gte("competence_month", month)
        .lte("competence_month", horizonMonth)
        .order("expected_due_date"),
      supabase.from("financial_people").select(
        "id,workspace_id,name,relation_type,is_dependent,is_active,color_key,notes",
      ).eq("workspace_id", input.workspaceId).is("archived_at", null)
        .neq("relation_type", "self")
        .order("name"),
      supabase.from("commitment_people").select(
        "commitment_id,person_id,allocation_type,allocation_value,is_primary,financial_people(id,name,is_dependent)",
      ).eq("workspace_id", input.workspaceId),
      supabase.from("transaction_people").select(
        "person_id,allocation_type,allocation_value,source,financial_transactions!inner(amount,competence_date)",
      ).eq("workspace_id", input.workspaceId)
        .gte("financial_transactions.competence_date", month)
        .lt(
          "financial_transactions.competence_date",
          nextMonth,
        ),
      supabase.from("financial_commitment_history")
        .select("id,commitment_id,event_type,summary,created_at")
        .eq("workspace_id", input.workspaceId)
        .order("created_at", { ascending: false }),
    ]);
  const failed = [
    commitmentsResult,
    occurrencesResult,
    peopleResult,
    allocationsResult,
    transactionPeopleResult,
    historyResult,
  ].find(result => result.error);
  if (failed?.error) {
    throwSupabaseError(
      failed.error,
      "getCommitmentsOverview",
      "Não foi possível carregar os compromissos.",
    );
  }
  const commitments = (commitmentsResult.data ?? [])
    .map(row => ({
      row: row as unknown as CommitmentRow,
      commitment: mapCommitment(row as unknown as CommitmentRow),
    }));
  const occurrences = (occurrencesResult.data ?? [])
    .map(row => mapOccurrence(row as unknown as OccurrenceRow));
  const allocationRows = (allocationsResult.data ?? []) as unknown as Array<{
    commitment_id: string;
    person_id: string;
    allocation_type: CommitmentPersonAllocation["allocationType"];
    allocation_value: number | string;
    is_primary: boolean;
    financial_people: {
      id: string;
      name: string;
      is_dependent: boolean;
    } | null;
  }>;
  const transactionAllocationRows =
    (transactionPeopleResult.data ?? []) as unknown as Array<{
      person_id: string;
      allocation_type: CommitmentPersonAllocation["allocationType"];
      allocation_value: number | string;
      source: string;
      financial_transactions: {
        amount: number | string;
        competence_date: string;
      } | null;
    }>;
  const items = commitments.map(({ row, commitment }) => {
    const related = occurrences.filter(item =>
      item.commitmentId === commitment.id
    );
    const current = related.find(item => item.competenceMonth === month) ?? null;
    const future = related.find(item =>
      item.competenceMonth > month &&
      !["paid", "cancelled", "skipped"].includes(item.status)
    ) ?? null;
    const people = allocationRows.filter(item =>
      item.commitment_id === commitment.id && item.financial_people
    ).map(item => ({
      id: item.financial_people!.id,
      name: item.financial_people!.name,
      isDependent: item.financial_people!.is_dependent,
    }));
    return {
      commitment,
      categoryName: row.financial_categories?.name ?? null,
      accountName: row.financial_accounts?.name ?? null,
      cardName: row.credit_cards
        ? `${row.credit_cards.name}${
          row.credit_cards.last_four_digits
            ? ` • ${row.credit_cards.last_four_digits}`
            : ""
        }`
        : null,
      people,
      currentOccurrence: current,
      nextOccurrence: related.find(item =>
        (item.expectedDueDate ?? "") >= month &&
        !["paid", "cancelled", "skipped"].includes(item.status)
      ) ?? null,
      futureOccurrence: future,
      history: (historyResult.data ?? []).filter(history =>
        history.commitment_id === commitment.id
      ).map(history => ({
        id: String(history.id),
        eventType: String(history.event_type),
        summary: String(history.summary),
        createdAt: String(history.created_at),
      })),
    };
  });
  const visibleCommitmentIds = new Set(
    items.map(item => item.commitment.id),
  );
  const activeOccurrences = occurrences.filter(item =>
    visibleCommitmentIds.has(item.commitmentId) &&
    !["cancelled", "skipped"].includes(item.status)
  );
  const currentOccurrences = activeOccurrences.filter(item =>
    item.competenceMonth === month
  );
  const amount = (item: CommitmentOccurrence) =>
    item.actualAmountCents ?? item.expectedAmountCents ?? 0;
  const people = ((peopleResult.data ?? []) as unknown as Array<{
    id: string;
    workspace_id: string;
    name: string;
    relation_type: string;
    is_dependent: boolean;
    is_active: boolean;
    color_key: string | null;
    notes: string | null;
  }>).map(row => {
    const person: FinancialPerson = {
      id: row.id,
      workspaceId: row.workspace_id,
      name: row.name,
      relationType: row.relation_type,
      isDependent: row.is_dependent,
      isActive: row.is_active,
      colorKey: row.color_key,
      notes: row.notes,
    };
    const allocations = allocationRows.filter(item =>
      item.person_id === person.id
    );
    const breakdown: PersonFinancialBreakdown = {
      actualSpentCents: 0,
      projectedCommitmentsCents: 0,
      recurringMonthlyCents: 0,
      extraordinarySpentCents: 0,
      pendingAmountCents: 0,
      overdueAmountCents: 0,
      analyticalSpentCents: 0,
      cashOutflowCents: 0,
      payrollDeductionAmountCents: 0,
      netAvailableImpactCents: 0,
    };
    for (const allocationRow of allocations) {
      const occurrence = currentOccurrences.find(item =>
        item.commitmentId === allocationRow.commitment_id
      );
      const commitment = commitments.find(item =>
        item.commitment.id === allocationRow.commitment_id
      )?.commitment;
      if (!occurrence || !commitment) continue;
      const allocation: CommitmentPersonAllocation = {
        personId: person.id,
        allocationType: allocationRow.allocation_type,
        allocationValue: Number(allocationRow.allocation_value),
        isPrimary: allocationRow.is_primary,
      };
      const allocated = allocatedAmountCents(amount(occurrence), allocation);
      breakdown.analyticalSpentCents += allocated;
      if (commitment.isPayrollDeduction) {
        breakdown.payrollDeductionAmountCents += allocated;
      } else {
        breakdown.netAvailableImpactCents += allocated;
        if (occurrence.status === "paid") {
          breakdown.cashOutflowCents += allocated;
        }
      }
      if (occurrence.status === "paid") breakdown.actualSpentCents += allocated;
      else breakdown.projectedCommitmentsCents += allocated;
      if (commitment.commitmentType === "one_time") {
        breakdown.extraordinarySpentCents += allocated;
      } else {
        breakdown.recurringMonthlyCents += allocated;
      }
      if (occurrence.status === "overdue") {
        breakdown.overdueAmountCents += allocated;
      } else if (["pending", "partially_paid"].includes(occurrence.status)) {
        breakdown.pendingAmountCents += allocated;
      }
    }
    for (const transactionAllocation of transactionAllocationRows.filter(
      item => item.person_id === person.id && item.source !== "commitment",
    )) {
      const transaction = transactionAllocation.financial_transactions;
      if (!transaction) continue;
      const transactionAmount = Math.abs(
        moneyToCents(transaction.amount) ?? 0,
      );
      const allocated = allocatedAmountCents(transactionAmount, {
        personId: person.id,
        allocationType: transactionAllocation.allocation_type,
        allocationValue: Number(transactionAllocation.allocation_value),
        isPrimary: false,
      });
      breakdown.actualSpentCents += allocated;
      breakdown.extraordinarySpentCents += allocated;
      breakdown.analyticalSpentCents += allocated;
      breakdown.cashOutflowCents += allocated;
      breakdown.netAvailableImpactCents += allocated;
    }
    return {
      person,
      breakdown,
      nextCommitment: items.find(item =>
        item.people.some(related => related.id === person.id) &&
        item.nextOccurrence
      )?.commitment.title ?? null,
    };
  });
  const alerts = [
    ...currentOccurrences.filter(item =>
      item.status === "overdue" &&
      !items.find(row => row.commitment.id === item.commitmentId)
        ?.commitment.isPayrollDeduction
    )
      .map(item => {
        const title = items.find(row =>
          row.commitment.id === item.commitmentId
        )?.commitment.title ?? "Compromisso";
        return `${title} está atrasado.`;
      }),
    ...currentOccurrences.filter(item => item.status === "partially_paid")
      .map(() => "Existe um pagamento parcial que precisa de revisão."),
  ];
  const budgetOccurrences = currentOccurrences.filter(occurrence => {
    const commitment = items.find(item =>
      item.commitment.id === occurrence.commitmentId
    )?.commitment;
    return commitment?.cashFlowDirection !== "income" &&
      commitment?.includeInMonthlyBudget !== false &&
      commitment?.planningEffect === "decrease";
  });
  const monthlyCommitmentTotals = resolveMonthlyCommitmentTotals(
    budgetOccurrences.map(occurrence => {
      const commitment = commitments.find(item =>
        item.commitment.id === occurrence.commitmentId
      )?.commitment;
      const peopleForCommitment = allocationRows
        .filter(item => item.commitment_id === occurrence.commitmentId)
        .map(item => ({
          personId: item.person_id,
          allocationType: item.allocation_type,
          allocationValue: Number(item.allocation_value),
          isPrimary: item.is_primary,
        }));
      return {
        occurrenceId: occurrence.id,
        commitmentId: occurrence.commitmentId,
        amountCents: amount(occurrence),
        status: occurrence.status,
        commitmentType: commitment?.commitmentType ?? "other",
        people: peopleForCommitment,
      };
    }),
  );
  const dependentCents = people.filter(row => row.person.isDependent).reduce(
    (sum, row) =>
      sum + row.breakdown.actualSpentCents +
      row.breakdown.projectedCommitmentsCents,
    0,
  );
  const categoryTotals = new Map<string, { name: string; amountCents: number }>();
  for (const occurrence of budgetOccurrences) {
    const item = items.find(candidate =>
      candidate.commitment.id === occurrence.commitmentId
    );
    const name = item?.categoryName ?? "Sem categoria";
    const current = categoryTotals.get(name) ?? { name, amountCents: 0 };
    current.amountCents += amount(occurrence);
    categoryTotals.set(name, current);
  }
  const primaryCategory = [...categoryTotals.values()].sort(
    (left, right) => right.amountCents - left.amountCents,
  )[0] ?? null;
  const recurring = getRecurringCommitmentsOverview({
    workspaceId: input.workspaceId,
    competenceMonth: month,
    sources: items.map(item => ({
      commitment: item.commitment,
      categoryName: item.categoryName,
      accountName: item.accountName,
      cardName: item.cardName,
      people: item.people,
      occurrence: item.currentOccurrence,
    })),
  });
  return {
    workspaceId: input.workspaceId,
    month,
    totals: {
      committedCents: monthlyCommitmentTotals.totalCommitted,
      paidCents: monthlyCommitmentTotals.realized,
      pendingCents: monthlyCommitmentTotals.pending +
        monthlyCommitmentTotals.projected,
      overdueCents: currentOccurrences.filter(item =>
        item.status === "overdue"
      ).reduce((sum, item) => sum + amount(item), 0),
      next30DaysCents: activeOccurrences.filter(item =>
        item.expectedDueDate &&
        item.expectedDueDate >= new Date().toISOString().slice(0, 10) &&
        item.expectedDueDate <= next30Date
      ).reduce((sum, item) => sum + amount(item), 0),
      recurringMonthlyCents: monthlyCommitmentTotals.recurring,
      dependentCents,
      primaryCategoryName: primaryCategory?.name ?? null,
      primaryCategoryCents: primaryCategory?.amountCents ?? 0,
    },
    commitments: items,
    people,
    occurrences,
    alerts: [...new Set(alerts)],
    recurring,
  };
}

export async function getMonthlyFinancialCommitments(
  supabase: SupabaseClient,
  input: { workspaceId: string; from: string },
): Promise<MonthlyCommitmentProjection[]> {
  const [occurrences, installments, loans] = await Promise.all([
    supabase.from("financial_commitment_occurrences").select(
      "competence_month,expected_amount,actual_amount,status,financial_commitments!inner(commitment_type,source,source_record_id,category_id,cash_flow_direction,payment_method,is_payroll_deduction,income_basis,cash_flow_effect,planning_effect,analytics_effect,payment_channel)",
    ).eq("workspace_id", input.workspaceId)
      .gte("competence_month", input.from),
    supabase.from("card_installment_occurrences").select(
      "competence_month,amount,status,installment_plan_id",
    ).eq("workspace_id", input.workspaceId)
      .gte("competence_month", input.from)
      .in("status", ["projected", "confirmed"]),
    supabase.from("financial_loans").select(
      "id,installment_amount,next_installment_date,status,installments_remaining,payroll_deducted,payment_source",
    ).eq("workspace_id", input.workspaceId).eq("status", "active"),
  ]);
  const commitmentOccurrences = (occurrences.data ?? []).map(row => {
      const commitment = Array.isArray(row.financial_commitments)
        ? row.financial_commitments[0]
        : row.financial_commitments;
      const effects = resolveCommitmentFinancialEffects({
        direction: commitment?.cash_flow_direction === "income"
          ? "income"
          : "expense",
        commitmentType: commitment?.commitment_type,
        paymentMethod: commitment?.payment_method,
        isPayrollDeduction: commitment?.is_payroll_deduction,
        incomeBasis: commitment?.income_basis,
        cashFlowEffect: commitment?.cash_flow_effect,
        planningEffect: commitment?.planning_effect,
        analyticsEffect: commitment?.analytics_effect,
        paymentChannel: commitment?.payment_channel,
      });
      return {
        competenceMonth: String(row.competence_month),
        expectedAmountCents: moneyToCents(row.expected_amount) ?? 0,
        actualAmountCents: moneyToCents(row.actual_amount),
        status: String(row.status) as CommitmentOccurrence["status"],
        commitmentType: String(commitment?.commitment_type) as
          FinancialCommitment["commitmentType"],
        source: String(commitment?.source ?? "manual"),
        sourceRecordId: commitment?.source_record_id
          ? String(commitment.source_record_id)
          : null,
        categoryId: commitment?.category_id
          ? String(commitment.category_id)
          : null,
        direction: commitment?.cash_flow_direction === "income"
          ? "income" as const
          : "expense" as const,
        cashFlowEffect: effects.cashFlowEffect,
        planningEffect: effects.planningEffect,
        paymentChannel: effects.paymentChannel,
        isPayrollDeduction: effects.isPayrollDeduction,
      };
    });
  const representedCardPlans = new Set(commitmentOccurrences
    .filter(item => item.source === "card_installment" && item.sourceRecordId)
    .map(item => item.sourceRecordId));
  const representedLoans = new Set(commitmentOccurrences
    .filter(item => item.source === "loan" && item.sourceRecordId)
    .map(item => item.sourceRecordId));
  const loanMonths = (loans.data ?? []).flatMap(row => {
    const isPayrollLoan = Boolean(row.payroll_deducted)
      || row.payment_source === "payroll";
    if (
      isPayrollLoan
      || !row.next_installment_date
      || representedLoans.has(String(row.id))
    ) {
      return [];
    }
    const count = Math.min(Math.max(Number(row.installments_remaining ?? 1), 1), 120);
    return Array.from({ length: count }, (_, index) => {
      const initial = new Date(`${row.next_installment_date}T12:00:00Z`);
      initial.setUTCMonth(initial.getUTCMonth() + index);
      return {
        competenceMonth: `${initial.toISOString().slice(0, 7)}-01`,
        amountCents: moneyToCents(row.installment_amount) ?? 0,
      };
    });
  });
  return buildMonthlyCommitmentProjections({
    occurrences: commitmentOccurrences,
    cardInstallments: (installments.data ?? [])
      .filter(row => !representedCardPlans.has(String(row.installment_plan_id)))
      .map(row => ({
      competenceMonth: String(row.competence_month),
      amountCents: moneyToCents(row.amount) ?? 0,
    })),
    loans: loanMonths,
  });
}

export async function getPersonFinancialSummary(
  supabase: SupabaseClient,
  input: {
    workspaceId: string;
    personId: string;
    from: string;
    to: string;
  },
): Promise<PersonFinancialSummary> {
  const [personResult, commitmentResult, transactionResult] = await Promise.all([
    supabase.from("financial_people")
      .select("id,workspace_id,name,relation_type,is_dependent,is_active,color_key,notes")
      .eq("workspace_id", input.workspaceId).eq("id", input.personId).single(),
    supabase.from("commitment_people").select(
      "allocation_type,allocation_value,financial_commitments!inner(commitment_type,category_id,financial_categories(name),financial_commitment_occurrences!inner(competence_month,expected_amount,actual_amount,status))",
    ).eq("workspace_id", input.workspaceId).eq("person_id", input.personId)
      .gte(
        "financial_commitments.financial_commitment_occurrences.competence_month",
        `${input.from.slice(0, 7)}-01`,
      )
      .lte(
        "financial_commitments.financial_commitment_occurrences.competence_month",
        `${input.to.slice(0, 7)}-01`,
      ),
    supabase.from("transaction_people").select(
      "allocation_type,allocation_value,source,financial_transactions:financial_transactions!transaction_people_transaction_id_fkey!inner(amount,competence_date,category_id,account_id,financial_categories:financial_categories!financial_transactions_category_id_fkey(name),financial_accounts:financial_accounts!financial_transactions_account_id_fkey(name))",
    ).eq("workspace_id", input.workspaceId).eq("person_id", input.personId)
      .gte("financial_transactions.competence_date", input.from)
      .lte("financial_transactions.competence_date", input.to),
  ]);
  const failed = [personResult, commitmentResult, transactionResult]
    .find(result => result.error);
  if (failed?.error || !personResult.data) {
    throwSupabaseError(
      failed?.error ?? { message: "person not found" },
      "getPersonFinancialSummary",
      "Não foi possível carregar o resumo da pessoa.",
    );
  }
  const personRow = personResult.data;
  const person: FinancialPerson = {
    id: personRow.id,
    workspaceId: personRow.workspace_id,
    name: personRow.name,
    relationType: personRow.relation_type,
    isDependent: personRow.is_dependent,
    isActive: personRow.is_active,
    colorKey: personRow.color_key,
    notes: personRow.notes,
  };
  const monthly = new Map<string, number>();
  const categories = new Map<string, { id: string | null; name: string; amountCents: number }>();
  const accounts = new Map<string, { id: string | null; name: string; amountCents: number }>();
  const breakdown: PersonFinancialBreakdown = {
    actualSpentCents: 0,
    projectedCommitmentsCents: 0,
    recurringMonthlyCents: 0,
    extraordinarySpentCents: 0,
    pendingAmountCents: 0,
    overdueAmountCents: 0,
    analyticalSpentCents: 0,
    cashOutflowCents: 0,
    payrollDeductionAmountCents: 0,
    netAvailableImpactCents: 0,
  };
  const addCategory = (id: string | null, name: string, amountCents: number) => {
    const key = id ?? "uncategorized";
    const current = categories.get(key) ?? { id, name, amountCents: 0 };
    current.amountCents += amountCents;
    categories.set(key, current);
  };
  for (const raw of commitmentResult.data ?? []) {
    const row = raw as unknown as {
      allocation_type: CommitmentPersonAllocation["allocationType"];
      allocation_value: number | string;
      financial_commitments: {
        commitment_type: FinancialCommitment["commitmentType"];
        category_id: string | null;
        financial_categories: { name: string } | null;
        financial_commitment_occurrences: Array<{
          competence_month: string;
          expected_amount: number | string | null;
          actual_amount: number | string | null;
          status: CommitmentOccurrence["status"];
        }>;
      } | null;
    };
    if (!row.financial_commitments) continue;
    for (const occurrence of row.financial_commitments.financial_commitment_occurrences) {
      if (["cancelled", "skipped"].includes(occurrence.status)) continue;
      const base = moneyToCents(
        occurrence.actual_amount ?? occurrence.expected_amount,
      ) ?? 0;
      const allocated = allocatedAmountCents(base, {
        personId: input.personId,
        allocationType: row.allocation_type,
        allocationValue: Number(row.allocation_value),
        isPrimary: false,
      });
      const payroll =
        row.financial_commitments.commitment_type === "payroll_deduction";
      breakdown.analyticalSpentCents += allocated;
      if (payroll) breakdown.payrollDeductionAmountCents += allocated;
      else {
        breakdown.netAvailableImpactCents += allocated;
        if (occurrence.status === "paid") {
          breakdown.cashOutflowCents += allocated;
        }
      }
      const monthKey = occurrence.competence_month.slice(0, 7);
      monthly.set(monthKey, (monthly.get(monthKey) ?? 0) + allocated);
      if (occurrence.status === "paid") breakdown.actualSpentCents += allocated;
      else breakdown.projectedCommitmentsCents += allocated;
      if (row.financial_commitments.commitment_type === "one_time") {
        breakdown.extraordinarySpentCents += allocated;
      } else breakdown.recurringMonthlyCents += allocated;
      if (occurrence.status === "overdue") breakdown.overdueAmountCents += allocated;
      if (["pending", "partially_paid"].includes(occurrence.status)) {
        breakdown.pendingAmountCents += allocated;
      }
      addCategory(
        row.financial_commitments.category_id,
        row.financial_commitments.financial_categories?.name ?? "Sem categoria",
        allocated,
      );
    }
  }
  for (const raw of transactionResult.data ?? []) {
    const row = raw as unknown as {
      allocation_type: CommitmentPersonAllocation["allocationType"];
      allocation_value: number | string;
      source: string;
      financial_transactions: {
        amount: number | string;
        competence_date: string;
        category_id: string | null;
        account_id: string | null;
        financial_categories: { name: string } | null;
        financial_accounts: { name: string } | null;
      } | null;
    };
    if (!row.financial_transactions || row.source === "commitment") continue;
    const transaction = row.financial_transactions;
    const allocated = allocatedAmountCents(
      Math.abs(moneyToCents(transaction.amount) ?? 0),
      {
        personId: input.personId,
        allocationType: row.allocation_type,
        allocationValue: Number(row.allocation_value),
        isPrimary: false,
      },
    );
    const monthKey = transaction.competence_date.slice(0, 7);
    monthly.set(monthKey, (monthly.get(monthKey) ?? 0) + allocated);
    breakdown.actualSpentCents += allocated;
    breakdown.extraordinarySpentCents += allocated;
    breakdown.analyticalSpentCents += allocated;
    breakdown.cashOutflowCents += allocated;
    breakdown.netAvailableImpactCents += allocated;
    addCategory(
      transaction.category_id,
      transaction.financial_categories?.name ?? "Sem categoria",
      allocated,
    );
    const accountKey = transaction.account_id ?? "unassigned";
    const account = accounts.get(accountKey) ?? {
      id: transaction.account_id,
      name: transaction.financial_accounts?.name ?? "Sem conta",
      amountCents: 0,
    };
    account.amountCents += allocated;
    accounts.set(accountKey, account);
  }
  const evolution = [...monthly.entries()].sort(([left], [right]) =>
    left.localeCompare(right)
  ).map(([evolutionMonth, amountCents]) => ({
    month: evolutionMonth,
    amountCents,
  }));
  const totalSpentCents = breakdown.actualSpentCents +
    breakdown.projectedCommitmentsCents;
  return {
    person,
    ...breakdown,
    totalSpentCents,
    paidCents: breakdown.actualSpentCents,
    averageMonthlyCents: evolution.length
      ? Math.round(totalSpentCents / evolution.length)
      : 0,
    categories: [...categories.values()].sort((a, b) =>
      b.amountCents - a.amountCents
    ),
    accounts: [...accounts.values()].sort((a, b) =>
      b.amountCents - a.amountCents
    ),
    monthlyEvolution: evolution,
  };
}
