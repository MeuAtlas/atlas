import type { FinancialPerson } from "./commitments";

export type PersonExpenseRecurrenceType =
  | "recurring"
  | "extraordinary"
  | "unknown";

export type PersonDashboardEntry = {
  id: string;
  canonicalKey: string;
  sourceType:
    | "bank_transaction"
    | "card_purchase"
    | "commitment"
    | "manual_expense";
  date: string;
  description: string;
  amountCents: number;
  categoryId: string | null;
  categoryName: string;
  accountId: string | null;
  accountName: string;
  direction: "inflow" | "outflow" | "neutral";
  status: string;
  linkSource: string;
  financialNature: string | null;
  financialRole: string | null;
  personFlowRole: string | null;
  reimbursementRole: string | null;
  incomeEffect: string;
  recurrenceType: PersonExpenseRecurrenceType;
  commitmentId: string | null;
  linkedTransactionId: string | null;
  linkedCardPurchaseId: string | null;
  isConfirmedExpense: boolean;
  isPix: boolean;
  isReimbursement: boolean;
  isUnclassifiedPix: boolean;
};

export type PersonDashboardReimbursement = {
  id: string;
  date: string;
  amountCents: number;
  status: string;
  isConfirmed: boolean;
  allocatedAmountCents: number;
};

export type PersonDashboardAllocation = {
  id: string;
  date: string | null;
  role: string;
  allocatedAmountCents: number;
  reimbursableAmountCents: number;
  reimbursedAmountCents: number;
  pendingAmountCents: number;
  status: string;
};

export type PersonDashboardCommitment = {
  id: string;
  title: string;
  categoryName: string;
  dueDate: string;
  amountCents: number;
  recurrenceType: PersonExpenseRecurrenceType;
  paymentMethod: string | null;
  status: string;
};

export type PersonDashboardCounterparty = {
  id: string;
  displayName: string;
  bankName: string | null;
  maskedIdentifier: string;
  directionScope: string;
  validFrom: string | null;
  isActive: boolean;
  movementCount: number;
  lastAppliedAt: string | null;
};

export type PersonFinancialDashboardData = {
  person: FinancialPerson;
  entries: PersonDashboardEntry[];
  reimbursements: PersonDashboardReimbursement[];
  allocations: PersonDashboardAllocation[];
  upcomingCommitments: PersonDashboardCommitment[];
  counterpartyLinks: PersonDashboardCounterparty[];
  dataQualityWarnings: string[];
  generatedAt: string;
};

export type PersonDashboardPeriod = {
  key: "this_month" | "previous_month" | "last_3" | "last_6" | "year" | "custom";
  from: string;
  to: string;
  label: string;
};

export type PersonMonthlySpend = {
  grossSpent: number;
  reimbursedAmount: number;
  netSpent: number;
  recurringSpent: number;
  extraordinarySpent: number;
  pixSentClassifiedAsExpense: number;
  pixReceivedAsReimbursement: number;
  unclassifiedPixAmount: number;
  transactionCount: number;
};

export type PersonSpendForPeriod = PersonMonthlySpend & {
  futureCommitments: number;
  dataQualityWarnings: string[];
};

export type PersonMonthlyTrendPoint = PersonMonthlySpend & {
  month: string;
};

export type PersonCategoryBreakdown = {
  categoryId: string | null;
  categoryName: string;
  total: number;
  percentage: number;
  transactionCount: number;
  recurringAmount: number;
  extraordinaryAmount: number;
};

export type PersonDashboardMovement = PersonDashboardEntry & {
  displayType: string;
};

export type PersonFinancialDashboard = {
  person: FinancialPerson;
  period: PersonDashboardPeriod;
  summary: {
    currentMonthSpent: number;
    grossSpent: number;
    monthlyAverage: number;
    previousMonthSpent: number;
    variationAmount: number;
    variationPercentage: number | null;
    comparisonLabel: "Acima da média" | "Abaixo da média" | "Dentro da média";
    upcomingCommitmentsAmount: number;
    upcomingCommitmentsCount: number;
    analyticalSpent: number;
    cashOutflow: number;
    payrollDeductionAmount: number;
    netAvailableImpact: number;
  };
  monthlyTrend: PersonMonthlyTrendPoint[];
  categoryBreakdown: PersonCategoryBreakdown[];
  recurringExpenses: {
    total: number;
    count: number;
    items: PersonDashboardMovement[];
  };
  extraordinaryExpenses: {
    total: number;
    count: number;
    items: PersonDashboardMovement[];
  };
  movements: PersonDashboardMovement[];
  pixSummary: {
    sentAmount: number;
    receivedAmount: number;
    balance: number;
    sentCount: number;
    receivedCount: number;
    unclassifiedAmount: number;
    unclassifiedCount: number;
    movements: PersonDashboardMovement[];
  };
  reimbursementSummary: {
    visible: boolean;
    grossExpense: number;
    userResponsibility: number;
    personResponsibility: number;
    reimbursed: number;
    pending: number;
    netCost: number;
  };
  upcomingCommitments: PersonDashboardCommitment[];
  annualSummary: {
    totalSpent: number;
    averageMonthly: number;
    mostExpensiveMonth: PersonMonthlyTrendPoint | null;
    leastExpensiveMonth: PersonMonthlyTrendPoint | null;
    recurringTotal: number;
    extraordinaryTotal: number;
    reimbursedTotal: number;
    netAnnualCost: number;
  };
  counterpartyLinks: PersonDashboardCounterparty[];
  dataQualityWarnings: string[];
};

const EXPENSE_NATURES = new Set([
  "purchase",
  "bill_payment",
  "fee",
  "interest",
  "financing_payment",
  "debt_payment",
  "pix_sent",
  "other",
]);
const NEUTRAL_NATURES = new Set([
  "invoice_payment",
  "transfer_internal",
  "transfer_external",
  "investment_application",
  "investment_redemption",
  "loan_proceeds",
  "reversal",
]);
const CLASSIFIED_PERSON_OUTFLOWS = new Set([
  "sent_to_person",
  "advance_to_person",
]);

const startOfMonth = (month: string) => `${month.slice(0, 7)}-01`;
const endOfMonth = (month: string) => {
  const value = new Date(`${startOfMonth(month)}T12:00:00Z`);
  value.setUTCMonth(value.getUTCMonth() + 1);
  value.setUTCDate(0);
  return value.toISOString().slice(0, 10);
};
const shiftMonth = (month: string, delta: number) => {
  const value = new Date(`${startOfMonth(month)}T12:00:00Z`);
  value.setUTCMonth(value.getUTCMonth() + delta);
  return value.toISOString().slice(0, 7);
};
const monthKeys = (from: string, to: string) => {
  const keys: string[] = [];
  let cursor = from.slice(0, 7);
  const last = to.slice(0, 7);
  while (cursor <= last && keys.length < 240) {
    keys.push(cursor);
    cursor = shiftMonth(cursor, 1);
  }
  return keys;
};

export function resolvePersonExpenseRecurrenceType(input: {
  commitmentType?: string | null;
  recurrenceFrequency?: string | null;
  linkedOccurrence?: boolean;
  manuallyRecurring?: boolean;
  confirmedDetectedRecurrence?: boolean;
}): PersonExpenseRecurrenceType {
  if (
    input.linkedOccurrence ||
    input.recurrenceFrequency ||
    (input.commitmentType &&
      !["one_time", "manual", "other"].includes(input.commitmentType))
  ) return "recurring";
  if (input.manuallyRecurring || input.confirmedDetectedRecurrence) {
    return "recurring";
  }
  return "extraordinary";
}

export function isPersonEntryExpense(entry: PersonDashboardEntry) {
  if (entry.direction !== "outflow" || entry.incomeEffect === "neutral") {
    return false;
  }
  if (entry.sourceType === "card_purchase") return true;
  if (entry.sourceType === "commitment") return entry.status === "paid";
  if (entry.isPix) {
    return CLASSIFIED_PERSON_OUTFLOWS.has(entry.personFlowRole ?? "") &&
      entry.reimbursementRole !== "common_transfer" &&
      entry.isConfirmedExpense;
  }
  if (NEUTRAL_NATURES.has(entry.financialNature ?? "")) return false;
  return entry.isConfirmedExpense ||
    EXPENSE_NATURES.has(entry.financialNature ?? "") ||
    entry.sourceType === "manual_expense";
}

export function canonicalPersonEntries(entries: PersonDashboardEntry[]) {
  const sorted = [...entries].sort((left, right) => {
    const priority = {
      bank_transaction: 4,
      card_purchase: 3,
      manual_expense: 2,
      commitment: 1,
    };
    return priority[right.sourceType] - priority[left.sourceType];
  });
  const seen = new Set<string>();
  return sorted.filter(entry => {
    const keys = [
      entry.canonicalKey,
      entry.linkedTransactionId
        ? `transaction:${entry.linkedTransactionId}`
        : null,
      entry.linkedCardPurchaseId
        ? `card:${entry.linkedCardPurchaseId}`
        : null,
    ].filter((key): key is string => Boolean(key));
    if (keys.some(key => seen.has(key))) return false;
    keys.forEach(key => seen.add(key));
    return true;
  });
}

export function calculatePersonMonthlySpend(input: {
  entries: PersonDashboardEntry[];
  reimbursements?: PersonDashboardReimbursement[];
  from: string;
  to: string;
}): PersonMonthlySpend {
  const inPeriod = canonicalPersonEntries(input.entries).filter(
    entry => entry.date >= input.from && entry.date <= input.to,
  );
  const expenses = inPeriod.filter(isPersonEntryExpense);
  const confirmedReimbursements = (input.reimbursements ?? []).filter(
    reimbursement =>
      reimbursement.date >= input.from &&
      reimbursement.date <= input.to &&
      reimbursement.isConfirmed,
  );
  const grossSpent = expenses.reduce(
    (sum, entry) => sum + Math.abs(entry.amountCents),
    0,
  );
  const reimbursedAmount = confirmedReimbursements.reduce(
    (sum, reimbursement) => sum + reimbursement.amountCents,
    0,
  );
  return {
    grossSpent,
    reimbursedAmount,
    netSpent: Math.max(grossSpent - reimbursedAmount, 0),
    recurringSpent: expenses
      .filter(entry => entry.recurrenceType === "recurring")
      .reduce((sum, entry) => sum + Math.abs(entry.amountCents), 0),
    extraordinarySpent: expenses
      .filter(entry => entry.recurrenceType !== "recurring")
      .reduce((sum, entry) => sum + Math.abs(entry.amountCents), 0),
    pixSentClassifiedAsExpense: expenses
      .filter(entry => entry.isPix)
      .reduce((sum, entry) => sum + Math.abs(entry.amountCents), 0),
    pixReceivedAsReimbursement: inPeriod
      .filter(entry => entry.direction === "inflow" && entry.isReimbursement)
      .reduce((sum, entry) => sum + Math.abs(entry.amountCents), 0),
    unclassifiedPixAmount: inPeriod
      .filter(entry => entry.isUnclassifiedPix)
      .reduce((sum, entry) => sum + Math.abs(entry.amountCents), 0),
    transactionCount: expenses.length,
  };
}

/**
 * Resolver canônico para qualquer resumo de gasto por pessoa.
 *
 * Todos os valores são expressos em centavos. A ausência de vínculo com pessoa
 * representa o próprio titular e, portanto, não entra neste cálculo.
 */
export function calculatePersonSpendForPeriod(input: {
  workspaceId: string;
  personId: string;
  periodStart: string;
  periodEnd: string;
  data: PersonFinancialDashboardData;
}): PersonSpendForPeriod {
  if (
    input.data.person.workspaceId !== input.workspaceId ||
    input.data.person.id !== input.personId ||
    input.data.person.relationType === "self"
  ) {
    return {
      grossSpent: 0,
      reimbursedAmount: 0,
      netSpent: 0,
      recurringSpent: 0,
      extraordinarySpent: 0,
      pixSentClassifiedAsExpense: 0,
      pixReceivedAsReimbursement: 0,
      unclassifiedPixAmount: 0,
      transactionCount: 0,
      futureCommitments: 0,
      dataQualityWarnings: ["Pessoa indisponível para o período solicitado."],
    };
  }
  const realized = calculatePersonMonthlySpend({
    entries: input.data.entries,
    reimbursements: input.data.reimbursements,
    from: input.periodStart,
    to: input.periodEnd,
  });
  const futureCommitments = input.data.upcomingCommitments
    .filter(commitment =>
      commitment.dueDate > input.periodEnd &&
      !["cancelled", "skipped", "paid"].includes(commitment.status)
    )
    .reduce((sum, commitment) => sum + commitment.amountCents, 0);
  return {
    ...realized,
    futureCommitments,
    dataQualityWarnings: input.data.dataQualityWarnings,
  };
}

export function getPersonMonthlyTrend(input: {
  entries: PersonDashboardEntry[];
  reimbursements?: PersonDashboardReimbursement[];
  from: string;
  to: string;
}) {
  return monthKeys(input.from, input.to).map(month => ({
    month,
    ...calculatePersonMonthlySpend({
      entries: input.entries,
      reimbursements: input.reimbursements,
      from: startOfMonth(month),
      to: endOfMonth(month),
    }),
  }));
}

export function getPersonMonthlyAverage(input: {
  monthlyValues: PersonMonthlyTrendPoint[];
}) {
  const monthsConsidered = input.monthlyValues.length;
  const activeMonths = input.monthlyValues.filter(point =>
    point.netSpent > 0
  ).length;
  const divide = (selector: (point: PersonMonthlyTrendPoint) => number) =>
    monthsConsidered
      ? Math.round(
          input.monthlyValues.reduce(
            (sum, point) => sum + selector(point),
            0,
          ) / monthsConsidered,
        )
      : 0;
  return {
    averageMonthlySpent: divide(point => point.netSpent),
    averageRecurring: divide(point => point.recurringSpent),
    averageExtraordinary: divide(point => point.extraordinarySpent),
    monthsConsidered,
    activeMonths,
    averageActiveMonths: activeMonths
      ? Math.round(
          input.monthlyValues.reduce(
            (sum, point) => sum + point.netSpent,
            0,
          ) / activeMonths,
        )
      : 0,
    monthlyValues: input.monthlyValues,
  };
}

export function calculateVariation(current: number, previous: number) {
  return {
    amount: current - previous,
    percentage: previous > 0
      ? ((current - previous) / previous) * 100
      : null,
  };
}

const displayType = (entry: PersonDashboardEntry) => {
  if (entry.isReimbursement) return "Reembolso";
  if (entry.isPix) return entry.direction === "inflow"
    ? "Pix recebido"
    : "Pix enviado";
  if (entry.sourceType === "card_purchase") return "Compra de cartão";
  if (entry.sourceType === "commitment") return "Compromisso";
  if (entry.financialNature === "payroll" ||
    entry.linkSource === "payroll") return "Desconto em folha";
  return entry.recurrenceType === "recurring"
    ? "Recorrente"
    : "Extraordinário";
};

export function getPersonCategoryBreakdown(
  movements: PersonDashboardMovement[],
): PersonCategoryBreakdown[] {
  const expenseMovements = movements.filter(isPersonEntryExpense);
  const total = expenseMovements.reduce(
    (sum, movement) => sum + Math.abs(movement.amountCents),
    0,
  );
  const grouped = new Map<string, PersonCategoryBreakdown>();
  for (const movement of expenseMovements) {
    const key = movement.categoryId ?? `fallback:${movement.categoryName}`;
    const current = grouped.get(key) ?? {
      categoryId: movement.categoryId,
      categoryName: movement.categoryName || "Outros",
      total: 0,
      percentage: 0,
      transactionCount: 0,
      recurringAmount: 0,
      extraordinaryAmount: 0,
    };
    const amount = Math.abs(movement.amountCents);
    current.total += amount;
    current.transactionCount += 1;
    if (movement.recurrenceType === "recurring") {
      current.recurringAmount += amount;
    } else current.extraordinaryAmount += amount;
    grouped.set(key, current);
  }
  return [...grouped.values()].map(item => ({
    ...item,
    percentage: total ? (item.total / total) * 100 : 0,
  })).sort((left, right) => right.total - left.total);
}

export function resolvePersonDashboardPeriod(
  key: PersonDashboardPeriod["key"],
  referenceMonth: string,
  custom?: { from: string; to: string },
): PersonDashboardPeriod {
  const month = referenceMonth.slice(0, 7);
  if (key === "previous_month") {
    const previous = shiftMonth(month, -1);
    return {
      key,
      from: startOfMonth(previous),
      to: endOfMonth(previous),
      label: "Mês anterior",
    };
  }
  if (key === "last_3" || key === "last_6") {
    const count = key === "last_3" ? 3 : 6;
    return {
      key,
      from: startOfMonth(shiftMonth(month, -(count - 1))),
      to: endOfMonth(month),
      label: `Últimos ${count} meses`,
    };
  }
  if (key === "year") {
    return {
      key,
      from: `${month.slice(0, 4)}-01-01`,
      to: endOfMonth(month),
      label: "Este ano",
    };
  }
  if (key === "custom" && custom?.from && custom?.to) {
    return {
      key,
      from: startOfMonth(custom.from),
      to: endOfMonth(custom.to),
      label: "Período personalizado",
    };
  }
  return {
    key: "this_month",
    from: startOfMonth(month),
    to: endOfMonth(month),
    label: "Este mês",
  };
}

export function selectPersonFinancialDashboard(input: {
  data: PersonFinancialDashboardData;
  period: PersonDashboardPeriod;
  referenceMonth: string;
  averageMonths?: 3 | 6 | 12;
  comparisonTolerance?: number;
}): PersonFinancialDashboard {
  const entries = canonicalPersonEntries(input.data.entries);
  const periodMovements = entries
    .filter(entry =>
      entry.date >= input.period.from && entry.date <= input.period.to
    )
    .map(entry => ({ ...entry, displayType: displayType(entry) }))
    .sort((left, right) => right.date.localeCompare(left.date));
  const trendPeriod = input.period.key === "this_month"
    ? resolvePersonDashboardPeriod("last_6", input.referenceMonth)
    : input.period;
  const monthlyTrend = getPersonMonthlyTrend({
    entries,
    reimbursements: input.data.reimbursements,
    from: trendPeriod.from,
    to: trendPeriod.to,
  });
  const selectedSpend = calculatePersonMonthlySpend({
    entries,
    reimbursements: input.data.reimbursements,
    from: input.period.from,
    to: input.period.to,
  });
  const selectedPayrollDeduction = periodMovements
    .filter(entry =>
      entry.financialNature === "payroll" || entry.linkSource === "payroll"
    )
    .reduce((sum, entry) => sum + Math.abs(entry.amountCents), 0);
  const selectedCashOutflow = periodMovements
    .filter(entry =>
      isPersonEntryExpense(entry) &&
      entry.financialNature !== "payroll" &&
      entry.linkSource !== "payroll"
    )
    .reduce((sum, entry) => sum + Math.abs(entry.amountCents), 0);
  const reference = input.referenceMonth.slice(0, 7);
  const current = calculatePersonMonthlySpend({
    entries,
    reimbursements: input.data.reimbursements,
    from: startOfMonth(reference),
    to: endOfMonth(reference),
  });
  const previousMonth = shiftMonth(reference, -1);
  const previous = calculatePersonMonthlySpend({
    entries,
    reimbursements: input.data.reimbursements,
    from: startOfMonth(previousMonth),
    to: endOfMonth(previousMonth),
  });
  const averageCount = input.averageMonths ?? 6;
  const averageTrend = getPersonMonthlyTrend({
    entries,
    reimbursements: input.data.reimbursements,
    from: startOfMonth(shiftMonth(reference, -(averageCount - 1))),
    to: endOfMonth(reference),
  });
  const average = getPersonMonthlyAverage({ monthlyValues: averageTrend });
  const variation = calculateVariation(current.netSpent, previous.netSpent);
  const tolerance = input.comparisonTolerance ?? 0.05;
  const comparisonLabel = current.netSpent > average.averageMonthlySpent *
      (1 + tolerance)
    ? "Acima da média"
    : current.netSpent < average.averageMonthlySpent * (1 - tolerance)
      ? "Abaixo da média"
      : "Dentro da média";
  const recurring = periodMovements.filter(
    movement =>
      isPersonEntryExpense(movement) &&
      movement.recurrenceType === "recurring",
  );
  const extraordinary = periodMovements.filter(
    movement =>
      isPersonEntryExpense(movement) &&
      movement.recurrenceType !== "recurring",
  );
  const pix = periodMovements.filter(movement => movement.isPix);
  const allocations = input.data.allocations.filter(allocation =>
    !allocation.date ||
    (allocation.date >= input.period.from && allocation.date <= input.period.to)
  );
  const beneficiaryGross = allocations
    .filter(allocation => allocation.role === "beneficiary")
    .reduce((sum, allocation) => sum + allocation.allocatedAmountCents, 0);
  const personResponsibility = allocations
    .filter(allocation => allocation.role === "shared_responsibility")
    .reduce((sum, allocation) => sum + allocation.allocatedAmountCents, 0);
  const reimbursed = allocations
    .filter(allocation => allocation.role === "shared_responsibility")
    .reduce((sum, allocation) => sum + allocation.reimbursedAmountCents, 0);
  const pending = allocations
    .filter(allocation => allocation.role === "shared_responsibility")
    .reduce((sum, allocation) => sum + allocation.pendingAmountCents, 0);
  const userResponsibility = Math.max(
    beneficiaryGross - personResponsibility,
    0,
  );
  const reimbursementVisible =
    beneficiaryGross > 0 ||
    personResponsibility > 0 ||
    reimbursed > 0 ||
    pending > 0;
  const upcoming = input.data.upcomingCommitments;
  const next30Date = new Date(`${endOfMonth(reference)}T12:00:00Z`);
  next30Date.setUTCDate(next30Date.getUTCDate() + 30);
  const next30 = input.data.upcomingCommitments.filter(
    commitment =>
      commitment.dueDate > endOfMonth(reference) &&
      commitment.dueDate <= next30Date.toISOString().slice(0, 10),
  );
  const year = reference.slice(0, 4);
  const annualTrend = getPersonMonthlyTrend({
    entries,
    reimbursements: input.data.reimbursements,
    from: `${year}-01-01`,
    to: endOfMonth(reference),
  });
  const annualAverage = getPersonMonthlyAverage({
    monthlyValues: annualTrend,
  });
  const activeAnnual = annualTrend.filter(point => point.netSpent > 0);
  const mostExpensiveMonth = activeAnnual.length
    ? activeAnnual.reduce((best, point) =>
        point.netSpent > best.netSpent ? point : best
      )
    : null;
  const leastExpensiveMonth = activeAnnual.length
    ? activeAnnual.reduce((best, point) =>
        point.netSpent < best.netSpent ? point : best
      )
    : null;
  const annualTotals = annualTrend.reduce(
    (totals, point) => ({
      gross: totals.gross + point.grossSpent,
      net: totals.net + point.netSpent,
      recurring: totals.recurring + point.recurringSpent,
      extraordinary: totals.extraordinary + point.extraordinarySpent,
      reimbursed: totals.reimbursed + point.reimbursedAmount,
    }),
    { gross: 0, net: 0, recurring: 0, extraordinary: 0, reimbursed: 0 },
  );
  return {
    person: input.data.person,
    period: input.period,
    summary: {
      currentMonthSpent: input.period.key === "this_month"
        ? current.netSpent
        : selectedSpend.netSpent,
      grossSpent: selectedSpend.grossSpent,
      monthlyAverage: average.averageMonthlySpent,
      previousMonthSpent: previous.netSpent,
      variationAmount: variation.amount,
      variationPercentage: variation.percentage,
      comparisonLabel,
      upcomingCommitmentsAmount: next30.reduce(
        (sum, commitment) => sum + commitment.amountCents,
        0,
      ),
      upcomingCommitmentsCount: next30.length,
      analyticalSpent: selectedSpend.grossSpent,
      cashOutflow: selectedCashOutflow,
      payrollDeductionAmount: selectedPayrollDeduction,
      netAvailableImpact: selectedCashOutflow,
    },
    monthlyTrend,
    categoryBreakdown: getPersonCategoryBreakdown(periodMovements),
    recurringExpenses: {
      total: recurring.reduce(
        (sum, movement) => sum + Math.abs(movement.amountCents),
        0,
      ),
      count: recurring.length,
      items: recurring.slice(0, 5),
    },
    extraordinaryExpenses: {
      total: extraordinary.reduce(
        (sum, movement) => sum + Math.abs(movement.amountCents),
        0,
      ),
      count: extraordinary.length,
      items: extraordinary.slice(0, 5),
    },
    movements: periodMovements,
    pixSummary: {
      sentAmount: pix.filter(movement => movement.direction === "outflow")
        .reduce((sum, movement) => sum + Math.abs(movement.amountCents), 0),
      receivedAmount: pix.filter(movement => movement.direction === "inflow")
        .reduce((sum, movement) => sum + Math.abs(movement.amountCents), 0),
      balance: pix.reduce(
        (sum, movement) => sum +
          (movement.direction === "inflow"
            ? Math.abs(movement.amountCents)
            : -Math.abs(movement.amountCents)),
        0,
      ),
      sentCount: pix.filter(movement => movement.direction === "outflow").length,
      receivedCount: pix.filter(movement => movement.direction === "inflow").length,
      unclassifiedAmount: pix.filter(movement => movement.isUnclassifiedPix)
        .reduce((sum, movement) => sum + Math.abs(movement.amountCents), 0),
      unclassifiedCount: pix.filter(movement => movement.isUnclassifiedPix).length,
      movements: pix.slice(0, 5),
    },
    reimbursementSummary: {
      visible: reimbursementVisible,
      grossExpense: beneficiaryGross,
      userResponsibility,
      personResponsibility,
      reimbursed,
      pending,
      netCost: Math.max(beneficiaryGross - reimbursed, 0),
    },
    upcomingCommitments: upcoming,
    annualSummary: {
      totalSpent: annualTotals.gross,
      averageMonthly: annualAverage.averageMonthlySpent,
      mostExpensiveMonth,
      leastExpensiveMonth,
      recurringTotal: annualTotals.recurring,
      extraordinaryTotal: annualTotals.extraordinary,
      reimbursedTotal: annualTotals.reimbursed,
      netAnnualCost: annualTotals.net,
    },
    counterpartyLinks: input.data.counterpartyLinks,
    dataQualityWarnings: input.data.dataQualityWarnings,
  };
}
