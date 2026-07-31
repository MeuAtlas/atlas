import type {
  AnalyticsEffect,
  CashFlowEffect,
  ExpensePaymentChannel,
  IncomeBasis,
  PlanningEffect,
} from "./financial-impact";

export type CommitmentType =
  | "recurring"
  | "one_time"
  | "installment"
  | "subscription"
  | "payroll_deduction"
  | "manual"
  | "other";
export type RecurrenceFrequency =
  | "weekly"
  | "biweekly"
  | "monthly"
  | "bimonthly"
  | "quarterly"
  | "semiannual"
  | "annual"
  | "custom";
export type CommitmentStatus =
  | "active"
  | "paused"
  | "completed"
  | "cancelled"
  | "archived";
export type FinancialFlowDirection = "income" | "expense";
export type OccurrenceStatus =
  | "projected"
  | "expected"
  | "pending"
  | "paid"
  | "partially_paid"
  | "overdue"
  | "skipped"
  | "cancelled"
  | "disputed"
  | "received"
  | "partially_received"
  | "above_expected"
  | "below_expected";
export type AllocationType = "percentage" | "fixed_amount" | "full";

export type FinancialPerson = {
  id: string;
  workspaceId: string;
  name: string;
  relationType: string;
  isDependent: boolean;
  isActive: boolean;
  colorKey: string | null;
  notes: string | null;
};

export type FinancialCommitment = {
  id: string;
  workspaceId: string;
  title: string;
  description: string | null;
  commitmentType: CommitmentType;
  recurrenceFrequency: RecurrenceFrequency | null;
  recurrenceInterval: number | null;
  amountType: "fixed" | "variable" | "estimated";
  expectedAmountCents: number | null;
  minimumExpectedAmountCents: number | null;
  maximumExpectedAmountCents: number | null;
  currencyCode: string;
  categoryId: string | null;
  accountId: string | null;
  cardId: string | null;
  paymentMethod: string | null;
  dueDay: number | null;
  dueDate: string | null;
  startDate: string;
  endDate: string | null;
  nextDueDate: string | null;
  status: CommitmentStatus;
  autoMatchEnabled: boolean;
  merchantMatchPattern: string | null;
  descriptionMatchPattern: string | null;
  expectedDayTolerance: number;
  expectedAmountToleranceCents: number | null;
  source: string;
  sourceRecordId: string | null;
  isPayrollDeduction: boolean;
  generatesFutureProjections: boolean;
  lastGeneratedUntil: string | null;
  cashFlowDirection?: "expense" | "income";
  includeInMonthlyBudget?: boolean;
  sameInvoice?: boolean;
  tags?: string[];
  sharedExpenseEnabled?: boolean;
  beneficiaryPersonId?: string | null;
  userResponsibilityType?: "full" | "percentage" | "fixed_amount" | null;
  userResponsibilityValue?: number | null;
  reimbursementPersonId?: string | null;
  reimbursementAllocationType?:
    | "full"
    | "percentage"
    | "fixed_amount"
    | "remainder"
    | null;
  reimbursementAllocationValue?: number | null;
  analysisGroupId?: string | null;
  analysisGroupName?: string | null;
  analysisGroupType?: string | null;
  contextType?: "personal" | "household" | "work" | "travel";
  budgetPriority?: "essential" | "adjustable" | "optional" | "unknown";
  naturalLanguageSource?: string | null;
  notes?: string | null;
  incomeBasis?: IncomeBasis | null;
  cashFlowEffect?: CashFlowEffect;
  planningEffect?: PlanningEffect;
  analyticsEffect?: AnalyticsEffect;
  paymentChannel?: ExpensePaymentChannel;
};

export type CommitmentOccurrence = {
  id: string;
  commitmentId: string;
  competenceMonth: string;
  sequenceNumber: number;
  expectedDueDate: string | null;
  expectedAmountCents: number | null;
  actualAmountCents: number | null;
  status: OccurrenceStatus;
  paymentDate: string | null;
  linkedTransactionId: string | null;
  linkedCardMovementId: string | null;
  matchConfidence: number | null;
  matchSource: string | null;
  manuallyConfirmed: boolean;
};

export type CommitmentPersonAllocation = {
  personId: string;
  allocationType: AllocationType;
  allocationValue: number;
  isPrimary: boolean;
};

export type CommitmentMatchCandidate = {
  occurrenceId: string;
  commitmentId: string;
  score: number;
  decision: "automatic" | "suggestion" | "ignored";
  reasons: string[];
};

export type PersonFinancialBreakdown = {
  actualSpentCents: number;
  projectedCommitmentsCents: number;
  recurringMonthlyCents: number;
  extraordinarySpentCents: number;
  pendingAmountCents: number;
  overdueAmountCents: number;
  analyticalSpentCents: number;
  cashOutflowCents: number;
  payrollDeductionAmountCents: number;
  netAvailableImpactCents: number;
};

export type MonthlyCommitmentTotalInput = {
  occurrenceId: string;
  commitmentId: string;
  amountCents: number;
  status: CommitmentOccurrence["status"];
  commitmentType: FinancialCommitment["commitmentType"];
  people: CommitmentPersonAllocation[];
};

export type MonthlyCommitmentTotals = {
  realized: number;
  pending: number;
  projected: number;
  totalCommitted: number;
  recurring: number;
  oneTime: number;
  byPerson: Record<string, number>;
  ownCommitments: number;
};

export function resolveMonthlyCommitmentTotals(
  rows: MonthlyCommitmentTotalInput[],
): MonthlyCommitmentTotals {
  const totals: MonthlyCommitmentTotals = {
    realized: 0,
    pending: 0,
    projected: 0,
    totalCommitted: 0,
    recurring: 0,
    oneTime: 0,
    byPerson: {},
    ownCommitments: 0,
  };
  const seen = new Set<string>();
  for (const row of rows) {
    if (seen.has(row.occurrenceId) ||
      ["cancelled", "skipped", "disputed"].includes(row.status)) continue;
    seen.add(row.occurrenceId);
    totals.totalCommitted += row.amountCents;
    if (row.status === "paid") totals.realized += row.amountCents;
    else if (row.status === "projected") totals.projected += row.amountCents;
    else totals.pending += row.amountCents;
    if (row.commitmentType === "one_time") totals.oneTime += row.amountCents;
    else totals.recurring += row.amountCents;
    if (!row.people.length) {
      totals.ownCommitments += row.amountCents;
      continue;
    }
    for (const allocation of row.people) {
      const allocated = allocatedAmountCents(row.amountCents, allocation);
      totals.byPerson[allocation.personId] =
        (totals.byPerson[allocation.personId] ?? 0) + allocated;
    }
  }
  return totals;
}

export type MonthlyCommitmentProjection = {
  competenceMonth: string;
  recurringTotalCents: number;
  installmentTotalCents: number;
  loanTotalCents: number;
  payrollTotalCents: number;
  oneTimeTotalCents: number;
  totalCommittedCents: number;
  confirmedTotalCents: number;
  projectedTotalCents: number;
  sourceCounts: Record<string, number>;
  peopleBreakdown: Record<string, number>;
  categoryBreakdown: Record<string, number>;
  expectedIncomeCents: number;
  realizedIncomeCents: number;
  remainingExpectedIncomeCents: number;
  projectedMonthIncomeCents: number;
  projectedBalanceCents: number;
};

export type PersonFinancialSummary = PersonFinancialBreakdown & {
  person: FinancialPerson;
  totalSpentCents: number;
  paidCents: number;
  averageMonthlyCents: number;
  categories: Array<{ id: string | null; name: string; amountCents: number }>;
  accounts: Array<{ id: string | null; name: string; amountCents: number }>;
  monthlyEvolution: Array<{ month: string; amountCents: number }>;
};

export type GeneratedOccurrence = {
  competenceMonth: string;
  sequenceNumber: number;
  expectedDueDate: string;
  expectedAmountCents: number | null;
  status: OccurrenceStatus;
};

const isoDate = (date: Date) => date.toISOString().slice(0, 10);
const monthStart = (value: string) => `${value.slice(0, 7)}-01`;
const dateAtNoon = (value: string) => new Date(`${value}T12:00:00Z`);

export function moneyToCents(value: number | string | null | undefined) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : null;
}

export function centsToMoney(value: number) {
  return Math.round(value) / 100;
}

export function validDayInMonth(year: number, monthIndex: number, day: number) {
  const lastDay = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  return Math.min(Math.max(day, 1), lastDay);
}

export function dueDateForMonth(competenceMonth: string, dueDay: number) {
  const year = Number(competenceMonth.slice(0, 4));
  const monthIndex = Number(competenceMonth.slice(5, 7)) - 1;
  const day = validDayInMonth(year, monthIndex, dueDay);
  return isoDate(new Date(Date.UTC(year, monthIndex, day)));
}

function addDays(value: string, days: number) {
  const date = dateAtNoon(value);
  date.setUTCDate(date.getUTCDate() + days);
  return isoDate(date);
}

function addMonths(value: string, months: number) {
  const year = Number(value.slice(0, 4));
  const monthIndex = Number(value.slice(5, 7)) - 1 + months;
  return isoDate(new Date(Date.UTC(year, monthIndex, 1)));
}

function nextOccurrenceDate(
  current: string,
  frequency: RecurrenceFrequency,
  interval: number,
) {
  if (frequency === "weekly") return addDays(current, 7 * interval);
  if (frequency === "biweekly") return addDays(current, 14 * interval);
  const months =
    frequency === "bimonthly" ? 2
      : frequency === "quarterly" ? 3
        : frequency === "semiannual" ? 6
          : frequency === "annual" ? 12
            : interval;
  return addMonths(current, months);
}

export function generateCommitmentOccurrences(input: {
  commitment: FinancialCommitment;
  from: string;
  until: string;
  existingKeys?: Set<string>;
  today?: string;
}): GeneratedOccurrence[] {
  const { commitment } = input;
  if (
    commitment.status !== "active" ||
    !commitment.generatesFutureProjections
  ) return [];
  const existing = input.existingKeys ?? new Set<string>();
  const today = input.today ?? isoDate(new Date());
  const end = commitment.endDate && commitment.endDate < input.until
    ? commitment.endDate
    : input.until;
  const dueDay =
    commitment.dueDay ??
    Number((commitment.dueDate ?? commitment.startDate).slice(8, 10));
  const results: GeneratedOccurrence[] = [];
  if (
    commitment.commitmentType === "one_time" ||
    !commitment.recurrenceFrequency
  ) {
    const due = commitment.dueDate ?? commitment.startDate;
    const competence = monthStart(due);
    const key = `${commitment.id}:${competence}:1`;
    if (due >= input.from && due <= end && !existing.has(key)) {
      results.push({
        competenceMonth: competence,
        sequenceNumber: 1,
        expectedDueDate: due,
        expectedAmountCents: commitment.expectedAmountCents,
        status: due < today ? "overdue" : "expected",
      });
    }
    return results;
  }

  let cursor = commitment.startDate;
  const interval = commitment.recurrenceInterval ?? 1;
  const monthSequences = new Map<string, number>();
  let guard = 0;
  while (cursor < input.from && guard++ < 1000) {
    cursor = nextOccurrenceDate(
      cursor,
      commitment.recurrenceFrequency,
      interval,
    );
  }
  while (cursor <= end && guard++ < 1000) {
    const competence = monthStart(cursor);
    const isWeekly = ["weekly", "biweekly"].includes(
      commitment.recurrenceFrequency,
    );
    const due = isWeekly ? cursor : dueDateForMonth(competence, dueDay);
    const sequence = (monthSequences.get(competence) ?? 0) + 1;
    const key = `${commitment.id}:${competence}:${sequence}`;
    monthSequences.set(competence, sequence);
    if (!existing.has(key)) {
      const isPayrollDeduction =
        commitment.commitmentType === "payroll_deduction" ||
        commitment.isPayrollDeduction;
      results.push({
        competenceMonth: competence,
        sequenceNumber: sequence,
        expectedDueDate: due,
        expectedAmountCents: commitment.expectedAmountCents,
        status: isPayrollDeduction
          ? due.slice(0, 7) <= today.slice(0, 7)
            ? "expected"
            : "projected"
          : due < today
            ? "overdue"
            : due.slice(0, 7) === today.slice(0, 7)
              ? "expected"
              : "projected",
      });
    }
    cursor = nextOccurrenceDate(
      cursor,
      commitment.recurrenceFrequency,
      interval,
    );
  }
  return results;
}

export function commitmentOccurrenceStatusLabel(
  status: string,
  isPayrollDeduction = false,
) {
  if (isPayrollDeduction) {
    if (status === "paid") return "Confirmado";
    if (["expected", "pending", "overdue"].includes(status)) {
      return "Considerado na renda líquida";
    }
    if (status === "projected") return "Estimado";
  }
  const labels: Record<string, string> = {
    active: "Ativo",
    paused: "Pausado",
    completed: "Encerrado",
    projected: "A pagar",
    expected: "A pagar",
    pending: "A pagar",
    paid: "Pago",
    partially_paid: "A pagar",
    overdue: "Atrasado",
    skipped: "Pulado",
    cancelled: "Encerrado",
  };
  return labels[status] ?? status;
}

export function resolveOccurrenceStatus(input: {
  current: OccurrenceStatus;
  dueDate: string | null;
  expectedAmountCents: number | null;
  actualAmountCents: number | null;
  paymentDate?: string | null;
  today: string;
}) {
  if (["skipped", "cancelled", "disputed"].includes(input.current)) {
    return input.current;
  }
  const actual = input.actualAmountCents ?? 0;
  const expected = input.expectedAmountCents ?? 0;
  if (actual > 0 && actual + 1 < expected) return "partially_paid" as const;
  if (input.paymentDate || (expected > 0 && actual >= expected - 1)) {
    return "paid" as const;
  }
  if (input.dueDate && input.dueDate < input.today) return "overdue" as const;
  if (
    input.dueDate &&
    input.dueDate.slice(0, 7) === input.today.slice(0, 7)
  ) return "pending" as const;
  return "projected" as const;
}

export function updateOccurrenceStatuses(
  occurrences: CommitmentOccurrence[],
  today: string,
) {
  return occurrences.map(occurrence => ({
    ...occurrence,
    status: resolveOccurrenceStatus({
      current: occurrence.status,
      dueDate: occurrence.expectedDueDate,
      expectedAmountCents: occurrence.expectedAmountCents,
      actualAmountCents: occurrence.actualAmountCents,
      paymentDate: occurrence.paymentDate,
      today,
    }),
  }));
}

export function validateAllocations(
  allocations: CommitmentPersonAllocation[],
  amountCents: number | null,
) {
  if (!allocations.length) return { valid: true, allocatedCents: 0 };
  const full = allocations.filter(item => item.allocationType === "full");
  if (full.length) {
    return {
      valid: allocations.length === 1 && full[0].allocationValue === 100,
      allocatedCents: amountCents ?? 0,
    };
  }
  const percentages = allocations.filter(
    item => item.allocationType === "percentage",
  );
  const fixed = allocations.filter(
    item => item.allocationType === "fixed_amount",
  );
  if (percentages.length && fixed.length) {
    return { valid: false, allocatedCents: 0 };
  }
  if (percentages.length) {
    const total = percentages.reduce(
      (sum, item) => sum + item.allocationValue,
      0,
    );
    return {
      valid: Math.abs(total - 100) <= 0.01,
      allocatedCents: amountCents ?? 0,
    };
  }
  const allocatedCents = fixed.reduce(
    (sum, item) => sum + Math.round(item.allocationValue * 100),
    0,
  );
  return {
    valid: amountCents === null || allocatedCents <= amountCents,
    allocatedCents,
  };
}

const normalized = (value: string | null | undefined) =>
  (value ?? "").normalize("NFD").replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("pt-BR").replace(/\s+/g, " ").trim();

export function scoreCommitmentMatch(input: {
  occurrence: CommitmentOccurrence;
  commitment: FinancialCommitment;
  transaction: {
    id: string;
    description: string;
    merchant?: string | null;
    amountCents: number;
    date: string;
    accountId?: string | null;
    cardId?: string | null;
  };
}): CommitmentMatchCandidate {
  const reasons: string[] = [];
  let score = 0;
  const description = normalized(input.transaction.description);
  const merchant = normalized(input.transaction.merchant);
  const patterns = [
    normalized(input.commitment.merchantMatchPattern),
    normalized(input.commitment.descriptionMatchPattern),
    normalized(input.commitment.title),
  ].filter(Boolean);
  if (patterns.some(pattern =>
    description.includes(pattern) || merchant.includes(pattern)
  )) {
    score += 0.4;
    reasons.push("descrição/merchant");
  }
  if (
    input.commitment.accountId &&
    input.commitment.accountId === input.transaction.accountId
  ) {
    score += 0.15;
    reasons.push("conta");
  }
  if (
    input.commitment.cardId &&
    input.commitment.cardId === input.transaction.cardId
  ) {
    score += 0.15;
    reasons.push("cartão");
  }
  const expected = input.occurrence.expectedAmountCents ??
    input.commitment.expectedAmountCents;
  if (expected !== null) {
    const tolerance = input.commitment.expectedAmountToleranceCents ??
      Math.max(100, Math.round(expected * 0.1));
    const difference = Math.abs(input.transaction.amountCents - expected);
    if (difference <= tolerance) {
      score += difference <= 1 ? 0.25 : 0.18;
      reasons.push("valor");
    }
  }
  if (input.occurrence.expectedDueDate) {
    const days = Math.abs(
      (dateAtNoon(input.transaction.date).valueOf() -
        dateAtNoon(input.occurrence.expectedDueDate).valueOf()) / 86_400_000,
    );
    if (days <= input.commitment.expectedDayTolerance) {
      score += 0.2;
      reasons.push("data");
    }
  }
  score = Math.min(1, Math.round(score * 100) / 100);
  return {
    occurrenceId: input.occurrence.id,
    commitmentId: input.commitment.id,
    score,
    decision: score >= 0.9 ? "automatic" : score >= 0.7
      ? "suggestion"
      : "ignored",
    reasons,
  };
}

export function allocatedAmountCents(
  amountCents: number,
  allocation: CommitmentPersonAllocation,
) {
  if (allocation.allocationType === "full") return amountCents;
  if (allocation.allocationType === "percentage") {
    return Math.round(amountCents * allocation.allocationValue / 100);
  }
  return Math.round(allocation.allocationValue * 100);
}

export function buildMonthlyCommitmentProjections(input: {
  occurrences: Array<{
    competenceMonth: string;
    expectedAmountCents: number;
    actualAmountCents: number | null;
    status: OccurrenceStatus;
    commitmentType: CommitmentType;
    source: string;
    sourceRecordId?: string | null;
    personAmounts?: Record<string, number>;
    categoryId?: string | null;
    direction?: FinancialFlowDirection;
    cashFlowEffect?: CashFlowEffect;
    planningEffect?: PlanningEffect;
    paymentChannel?: ExpensePaymentChannel;
    isPayrollDeduction?: boolean;
  }>;
  cardInstallments?: Array<{ competenceMonth: string; amountCents: number }>;
  loans?: Array<{ competenceMonth: string; amountCents: number }>;
}): MonthlyCommitmentProjection[] {
  const months = new Map<string, MonthlyCommitmentProjection>();
  const ensure = (month: string) => {
    const existing = months.get(month);
    if (existing) return existing;
    const created: MonthlyCommitmentProjection = {
      competenceMonth: month,
      recurringTotalCents: 0,
      installmentTotalCents: 0,
      loanTotalCents: 0,
      payrollTotalCents: 0,
      oneTimeTotalCents: 0,
      totalCommittedCents: 0,
      confirmedTotalCents: 0,
      projectedTotalCents: 0,
      sourceCounts: {},
      peopleBreakdown: {},
      categoryBreakdown: {},
      expectedIncomeCents: 0,
      realizedIncomeCents: 0,
      remainingExpectedIncomeCents: 0,
      projectedMonthIncomeCents: 0,
      projectedBalanceCents: 0,
    };
    months.set(month, created);
    return created;
  };
  for (const occurrence of input.occurrences) {
    if (["cancelled", "skipped"].includes(occurrence.status)) continue;
    const month = ensure(occurrence.competenceMonth);
    const amount = occurrence.actualAmountCents ??
      occurrence.expectedAmountCents;
    if (occurrence.direction === "income") {
      const realized = occurrence.actualAmountCents ?? 0;
      month.expectedIncomeCents += occurrence.expectedAmountCents;
      month.realizedIncomeCents += realized;
      month.remainingExpectedIncomeCents += Math.max(
        occurrence.expectedAmountCents - realized,
        0,
      );
      month.projectedMonthIncomeCents += Math.max(
        occurrence.expectedAmountCents,
        realized,
      );
      month.sourceCounts[occurrence.source] =
        (month.sourceCounts[occurrence.source] ?? 0) + 1;
      continue;
    }
    if (occurrence.commitmentType === "payroll_deduction") {
      month.payrollTotalCents += amount;
    } else if (occurrence.commitmentType === "installment") {
      month.installmentTotalCents += amount;
    } else if (occurrence.commitmentType === "one_time") {
      month.oneTimeTotalCents += amount;
    } else {
      month.recurringTotalCents += amount;
    }
    const informationalPayroll =
      occurrence.isPayrollDeduction ||
      occurrence.paymentChannel === "payroll" ||
      occurrence.planningEffect === "informational" ||
      occurrence.cashFlowEffect === "none";
    if (!informationalPayroll) {
      month.totalCommittedCents += amount;
      if (occurrence.status === "paid") month.confirmedTotalCents += amount;
      else month.projectedTotalCents += amount;
    }
    month.sourceCounts[occurrence.source] =
      (month.sourceCounts[occurrence.source] ?? 0) + 1;
    for (const [personId, personAmount] of Object.entries(
      occurrence.personAmounts ?? {},
    )) {
      month.peopleBreakdown[personId] =
        (month.peopleBreakdown[personId] ?? 0) + personAmount;
    }
    const categoryKey = occurrence.categoryId ?? "uncategorized";
    month.categoryBreakdown[categoryKey] =
      (month.categoryBreakdown[categoryKey] ?? 0) + amount;
  }
  for (const item of input.cardInstallments ?? []) {
    const month = ensure(item.competenceMonth);
    month.installmentTotalCents += item.amountCents;
    month.totalCommittedCents += item.amountCents;
    month.projectedTotalCents += item.amountCents;
    month.sourceCounts.card_installment =
      (month.sourceCounts.card_installment ?? 0) + 1;
  }
  for (const item of input.loans ?? []) {
    const month = ensure(item.competenceMonth);
    month.loanTotalCents += item.amountCents;
    month.totalCommittedCents += item.amountCents;
    month.projectedTotalCents += item.amountCents;
    month.sourceCounts.loan = (month.sourceCounts.loan ?? 0) + 1;
  }
  for (const month of months.values()) {
    month.projectedBalanceCents =
      month.projectedMonthIncomeCents - month.totalCommittedCents;
  }
  return [...months.values()].sort((a, b) =>
    a.competenceMonth.localeCompare(b.competenceMonth)
  );
}
