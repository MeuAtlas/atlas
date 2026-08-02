import { createHash } from "node:crypto";

import {
  calculateMonthlyFinancialResult,
  financialCompetenceDate,
  getFinanceMonthPeriod,
  isInFinanceScope,
  type FinanceCalculationScope,
  type FinanceMonthPeriod,
} from "./monthly-result";
import { calculateBankCashFlowForAccounts } from "./account-movement";
import type { CardPurchase, FinancialTransaction } from "./types";

export const MONTH_REPORT_TIME_ZONE = "America/Fortaleza";

export type FinancialMonthStatus =
  | "open"
  | "awaiting_consolidation"
  | "review"
  | "closing"
  | "closed"
  | "reopened";

export type MonthlyIssue = {
  key: string;
  type: string;
  severity: "info" | "warning" | "blocking";
  title: string;
  description: string;
  relatedEntityType?: string;
  relatedEntityId?: string;
  amount?: number;
};

export type MonthlyCardPurchase = CardPurchase & {
  financial_responsible_id?: string | null;
  responsibility_type?:
    | "own_expense"
    | "third_party_expense"
    | "shared_expense"
    | "business_reimbursable"
    | "uncertain"
    | null;
  personal_share_amount?: number | null;
  third_party_share_amount?: number | null;
  responsibility_confirmed?: boolean | null;
  date_source?: string | null;
  credit_card_instruments?: {
    payment_responsible_person_id?: string | null;
    default_financial_responsible_id?: string | null;
    responsibility_mode?: "own_expense" | "third_party_expense" | "shared_expense" | "business_reimbursable" | "uncertain" | null;
  } | null;
};

export type MonthlyStatement = {
  id: string;
  card_id: string;
  card_name: string;
  official_total_amount: number | null;
  calculated_total_amount: number;
  reconciliation_difference: number | null;
  reconciliation_status: string | null;
  official_amount_confirmed: boolean;
  closing_date: string;
  due_date: string;
  cycle_start_date?: string | null;
  cycle_end_date?: string | null;
  statement_file_path?: string | null;
  reference_month?: string | null;
};

export type MonthlyAllocation = {
  source_card_movement_id?: string | null;
  allocated_amount: number;
  reimbursable_amount: number;
  reimbursed_amount: number;
  pending_reimbursement_amount: number;
  person_id: string;
  person_name?: string;
};

export type MonthlyReportSnapshot = {
  schemaVersion: 1 | 2;
  generatedAt: string;
  tracking: {
    startedAt: string;
    availableDataStartAt: string;
    isFirstFinancialReport: boolean;
    isPartialInitialMonth: boolean;
    reportOrigin: "live_tracked" | "historically_reconstructed";
  };
  period: FinanceMonthPeriod;
  totals: {
    openingBalance: number;
    closingBalance: number;
    totalIncome: number;
    totalBankOutflows: number;
    cashResult: number;
    personalConsumption: number;
    totalCardConsumption: number;
    forecastCardInvoice: number;
    thirdPartyCardConsumption: number;
    reimbursementsReceived: number;
    reimbursementsPending: number;
    futureCommitments: number;
    totalRealIncome?: number;
    totalBankInflows?: number;
    personalCardConsumption?: number;
    futureCommitments30d?: number;
    futureCommitments60d?: number;
    futureCommitments90d?: number;
  };
  accounts: Array<{ id: string; name: string; openingBalance: number; closingBalance: number; lastSyncAt?: string | null }>;
  statements: MonthlyStatement[];
  entries: ReturnType<typeof calculateMonthlyFinancialResult>["entries"];
  allocations: MonthlyAllocation[];
  issues: MonthlyIssue[];
  narrative?: string[];
  incomePerspective?: MonthlyPerspective;
  cardPerspective?: MonthlyPerspective;
  consumptionCategories?: Array<{ name: string; amount: number; share: number }>;
  cashFlow?: Array<{ date: string; label: string; dailyInflow: number; dailyOutflow: number; cumulativeInflow: number; cumulativeOutflow: number }>;
  highlights?: {
    largestInflow: number;
    largestOutflow: number;
    movementCount: number;
    largestRealIncome: number;
  };
  futureCommitments?: Array<{ month: string; amount: number }>;
  loans?: Array<{ id: string; name: string; institution: string | null; outstandingBalance: number; installmentAmount: number; remainingInstallments: number | null; nextDueDate: string | null; payrollDeducted: boolean }>;
};

export type MonthlyPerspective = {
  current: number;
  reference: number | null;
  absoluteDifference: number | null;
  percentageDifference: number | null;
  monthsUsed: number;
  referenceLabel: string;
  message: string;
};

const roundMoney = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const amountOf = (purchase: MonthlyCardPurchase) =>
  Math.abs(Number(purchase.amount_brl ?? purchase.installment_amount ?? purchase.total_amount ?? 0));

const median = (values: number[]) => {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : roundMoney((sorted[middle - 1] + sorted[middle]) / 2);
};

export function calculateMonthlyPerspective(input: {
  current: number;
  history?: number[];
  reference?: number | null;
  monthsUsed?: number;
  subject: "income" | "card";
}) {
  const history = (input.history ?? []).slice(-12);
  const monthsUsed = input.monthsUsed ?? history.length;
  const reference = input.reference !== undefined
    ? input.reference
    : median(history);
  const absoluteDifference = reference == null ? null : roundMoney(input.current - reference);
  const percentageDifference = reference && absoluteDifference != null
    ? Math.round((absoluteDifference / reference) * 1000) / 10
    : null;
  const referenceLabel = monthsUsed >= 3
    ? `Mediana dos últimos ${monthsUsed} meses`
    : monthsUsed === 2
      ? "Comparação recente baseada nos dois meses anteriores"
      : monthsUsed === 1
        ? "Comparação com o mês anterior"
        : "Sem histórico anterior";
  const subject = input.subject === "income" ? "Sua renda" : "Sua fatura";
  const message = reference == null || percentageDifference == null
    ? "Ainda não há dados históricos suficientes para esta comparação."
    : Math.abs(percentageDifference) <= 5
      ? `${subject} ficou próximo do padrão recente.`
      : percentageDifference > 5
        ? input.subject === "income" ? "Você recebeu mais que a sua referência recente." : "A fatura deste mês ficou acima do padrão recente."
        : input.subject === "income" ? "Você recebeu menos que a sua referência recente." : "A fatura deste mês ficou abaixo do padrão recente.";
  return { current: roundMoney(input.current), reference, absoluteDifference, percentageDifference, monthsUsed, referenceLabel, message } satisfies MonthlyPerspective;
}

export function buildMonthlyNarrative(input: {
  cashResult: number;
  closingBalance: number;
  personalConsumption: number;
  bankOutflows: number;
  incomePerspective: MonthlyPerspective;
}) {
  const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
  const messages: string[] = [];
  if (input.cashResult < 0) messages.push(`Neste mês, saiu ${currency.format(Math.abs(input.cashResult))} a mais do que entrou.`);
  else if (input.cashResult > 0) messages.push(`Neste mês, entrou ${currency.format(input.cashResult)} a mais do que saiu.`);
  else messages.push("As entradas e saídas bancárias ficaram equilibradas neste mês.");
  if (input.closingBalance > 0) messages.push("Você terminou o período com saldo bancário positivo.");
  if (input.personalConsumption < input.bankOutflows) messages.push("Seu consumo pessoal foi menor que a saída total das contas porque caixa e consumo seguem momentos diferentes.");
  if (input.incomePerspective.monthsUsed > 0) messages.push(input.incomePerspective.message);
  return messages.slice(0, 3);
}

export function isRealIncomeEntry(entry: ReturnType<typeof calculateMonthlyFinancialResult>["entries"][number]) {
  if (entry.kind !== "revenue") return false;
  const technicalKind = `${entry.financialRole ?? ""} ${entry.financialNature ?? ""} ${entry.transactionRole ?? ""}`.toLocaleLowerCase("pt-BR");
  if (/transfer|refund|reimburse|investment|principal|loan|adjust|correction|cash_flow_only/.test(technicalKind)) return false;
  const description = entry.description.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase("pt-BR");
  return !/\b(resgate|aplicacao|estorno|reembolso|emprestimo|transferencia|ajuste de saldo)\b/.test(description);
}

export function getMonthlyPeriod(year: number, month: number) {
  return getFinanceMonthPeriod({ year, month, timeZone: MONTH_REPORT_TIME_ZONE });
}

export function resolveAutomaticMonthStatus(input: {
  period: FinanceMonthPeriod;
  now?: Date;
  persistedStatus?: FinancialMonthStatus | null;
  recommendedCloseAt?: string | null;
}) {
  const { period, persistedStatus, recommendedCloseAt } = input;
  if (persistedStatus && ["closing", "closed", "reopened"].includes(persistedStatus)) {
    return persistedStatus;
  }
  const now = input.now ?? new Date();
  if (now < new Date(period.endExclusiveInstant)) return "open" as const;
  if (recommendedCloseAt && now < new Date(recommendedCloseAt)) {
    return "awaiting_consolidation" as const;
  }
  return persistedStatus === "review" ? "review" as const : "awaiting_consolidation" as const;
}

export function availableFinancialMonths(input: {
  year: number;
  trackingStartYear: number;
  trackingStartMonth: number;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;
  if (input.year < input.trackingStartYear || input.year > currentYear) return [];
  const first = input.year === input.trackingStartYear ? input.trackingStartMonth : 1;
  const last = input.year === currentYear ? currentMonth : 12;
  return first > last ? [] : Array.from({ length: last - first + 1 }, (_, index) => first + index);
}

export function isBeforeFinancialTracking(input: {
  year: number;
  month: number;
  trackingStartYear: number;
  trackingStartMonth: number;
}) {
  return input.year * 12 + input.month < input.trackingStartYear * 12 + input.trackingStartMonth;
}

export function getMonthlyCardTransactions(
  purchases: MonthlyCardPurchase[],
  period: FinanceMonthPeriod,
) {
  return purchases.filter((purchase) => {
    const date = financialCompetenceDate(purchase, period.timeZone);
    return Boolean(date && date >= period.startDate && date < period.endExclusiveDate);
  });
}

export function resolveMonthlyPurchaseResponsibility(
  purchase: MonthlyCardPurchase,
): MonthlyCardPurchase {
  if (
    purchase.responsibility_confirmed &&
    purchase.responsibility_type &&
    purchase.responsibility_type !== "uncertain"
  ) {
    return purchase;
  }
  const amount = amountOf(purchase);
  const instrument = purchase.credit_card_instruments;
  const assignedPersonId = instrument?.payment_responsible_person_id ??
    instrument?.default_financial_responsible_id ?? null;
  if (assignedPersonId) {
    return {
      ...purchase,
      financial_responsible_id: assignedPersonId,
      responsibility_type: "third_party_expense",
      personal_share_amount: 0,
      third_party_share_amount: amount,
      responsibility_confirmed: true,
    };
  }
  return {
    ...purchase,
    financial_responsible_id: null,
    responsibility_type: "own_expense",
    personal_share_amount: amount,
    third_party_share_amount: 0,
    responsibility_confirmed: true,
  };
}

export function isStatementForMonthlyConsumption(
  statement: MonthlyStatement,
  period: FinanceMonthPeriod,
) {
  const expectedReferenceMonth = period.endExclusiveDate.slice(0, 7);
  const statementReferenceMonth = statement.reference_month?.slice(0, 7) ??
    statement.closing_date.slice(0, 7);
  return statementReferenceMonth === expectedReferenceMonth;
}

export function calculateStatementReconciliation(statement: MonthlyStatement) {
  if (statement.official_total_amount == null) return null;
  return roundMoney(statement.official_total_amount - statement.calculated_total_amount);
}

export function calculateCardConsumption(purchases: MonthlyCardPurchase[]) {
  return roundMoney(purchases.reduce((sum, purchase) => {
    const sign = purchase.transaction_role === "refund" ? -1 : 1;
    return sum + sign * amountOf(purchase);
  }, 0));
}

export function calculateThirdPartyConsumption(purchases: MonthlyCardPurchase[]) {
  return roundMoney(purchases.reduce((sum, purchase) => {
    const amount = amountOf(purchase);
    const sign = purchase.transaction_role === "refund" ? -1 : 1;
    if (purchase.third_party_share_amount != null) {
      return sum + sign * Math.abs(Number(purchase.third_party_share_amount));
    }
    if (["third_party_expense", "business_reimbursable"].includes(purchase.responsibility_type ?? "")) {
      return sum + sign * amount;
    }
    return sum;
  }, 0));
}

export function calculatePersonalConsumption(
  baseConsumption: number,
  purchases: MonthlyCardPurchase[],
) {
  const cardTotal = calculateCardConsumption(purchases);
  const thirdParty = calculateThirdPartyConsumption(purchases);
  return roundMoney(baseConsumption - cardTotal + Math.max(0, cardTotal - thirdParty));
}

export function calculateReimbursements(allocations: MonthlyAllocation[]) {
  return allocations.reduce((totals, allocation) => ({
    received: roundMoney(totals.received + Number(allocation.reimbursed_amount || 0)),
    pending: roundMoney(totals.pending + Number(allocation.pending_reimbursement_amount || 0)),
  }), { received: 0, pending: 0 });
}

export function validateMonthlyClosing(input: {
  period: FinanceMonthPeriod;
  now?: Date;
  status: FinancialMonthStatus;
  statements: MonthlyStatement[];
  purchases: MonthlyCardPurchase[];
  allocations?: MonthlyAllocation[];
  accountsSyncHealthy?: boolean;
}) {
  const issues: MonthlyIssue[] = [];
  const now = input.now ?? new Date();
  if (now < new Date(input.period.endExclusiveInstant)) {
    issues.push({ key: "month_open", type: "month_not_finished", severity: "blocking", title: "Este mês ainda está em andamento", description: "O fechamento definitivo estará disponível depois do último dia do mês." });
  }
  if (input.status === "closing") {
    issues.push({ key: "closing", type: "closing_in_progress", severity: "blocking", title: "O mês já está sendo concluído", description: "Aguarde alguns instantes. Não é necessário clicar novamente." });
  }
  for (const statement of input.statements) {
    if (!statement.official_amount_confirmed || statement.official_total_amount == null) {
      issues.push({ key: `statement:${statement.id}:unconfirmed`, type: "statement_not_confirmed", severity: "blocking", title: `Falta confirmar a fatura de ${statement.card_name}`, description: "Informe ou confirme o valor oficial da fatura para continuar.", relatedEntityType: "card_invoice", relatedEntityId: statement.id });
    }
    const difference = calculateStatementReconciliation(statement);
    if (difference != null && Math.abs(difference) >= 0.01 && !["matched", "manually_adjusted", "confirmed_with_difference"].includes(statement.reconciliation_status ?? "")) {
      issues.push({ key: `statement:${statement.id}:difference`, type: "statement_difference", severity: "blocking", title: `Há uma diferença na fatura de ${statement.card_name}`, description: "Confira a origem da diferença ou confirme-a com uma observação.", relatedEntityType: "card_invoice", relatedEntityId: statement.id, amount: difference });
    }
  }
  for (const purchase of input.purchases) {
    if (!purchase.responsibility_confirmed || !purchase.responsibility_type || purchase.responsibility_type === "uncertain") {
      issues.push({ key: `purchase:${purchase.id}:responsibility`, type: "unassigned_card_purchase", severity: "blocking", title: "Ainda precisamos saber quem deve pagar esta compra", description: purchase.description, relatedEntityType: "card_purchase", relatedEntityId: purchase.id, amount: amountOf(purchase) });
    }
    if (!purchase.competence_date) {
      issues.push({ key: `purchase:${purchase.id}:inferred-date`, type: "inferred_competence", severity: "warning", title: "A data de uma compra foi inferida", description: `${purchase.description} foi incluída pela melhor data disponível.`, relatedEntityType: "card_purchase", relatedEntityId: purchase.id });
    }
  }
  if (input.accountsSyncHealthy === false) {
    issues.push({ key: "account_sync", type: "account_sync_outdated", severity: "blocking", title: "Uma conta precisa ser atualizada", description: "Existe uma falha importante de sincronização. Atualize os dados antes de concluir." });
  }
  const pending = calculateReimbursements(input.allocations ?? []).pending;
  if (pending > 0) {
    issues.push({ key: "pending_reimbursements", type: "pending_reimbursement", severity: "info", title: "Ainda existem valores a receber", description: "Isso não impede o fechamento do mês.", amount: pending });
  }
  return { issues, blockers: issues.filter((issue) => issue.severity === "blocking"), canClose: !issues.some((issue) => issue.severity === "blocking") };
}

export function buildMonthlySnapshot(input: {
  period: FinanceMonthPeriod;
  generatedAt?: string;
  transactions: FinancialTransaction[];
  subsequentTransactions?: FinancialTransaction[];
  purchases: MonthlyCardPurchase[];
  statements: MonthlyStatement[];
  allocations: MonthlyAllocation[];
  accounts: Array<{ id: string; name: string; openingBalance: number; closingBalance: number; lastSyncAt?: string | null }>;
  forecastCardInvoice?: number;
  futureCommitments?: number;
  status: FinancialMonthStatus;
  scope?: FinanceCalculationScope;
  accountsSyncHealthy?: boolean;
  historicalSnapshots?: MonthlyReportSnapshot[];
  incomeHistoricalReference?: { median: number | null; months: number };
  cardInvoiceHistoricalReference?: { median: number | null; months: number };
  futureCommitmentMonths?: Array<{ month: string; amount: number }>;
  loans?: MonthlyReportSnapshot["loans"];
  tracking?: {
    startedAt: string;
    availableDataStartAt?: string;
    isFirstFinancialReport?: boolean;
    isPartialInitialMonth?: boolean;
    reportOrigin?: "live_tracked" | "historically_reconstructed";
  };
}) {
  const purchases = getMonthlyCardTransactions(input.purchases, input.period)
    .map(resolveMonthlyPurchaseResponsibility);
  const scope = input.scope ?? {
    workspaceId: input.transactions[0]?.workspace_id ?? input.purchases[0]?.workspace_id,
  };
  const result = calculateMonthlyFinancialResult({
    transactions: input.transactions,
    purchases,
    period: input.period,
    scope,
  });
  const scopedTransactions = input.transactions.filter((transaction) =>
    isInFinanceScope(transaction, scope),
  );
  const bankCashFlow = calculateBankCashFlowForAccounts({
    accountIds: input.accounts.map((account) => account.id),
    transactions: scopedTransactions,
    period: input.period,
  });
  const totalIncome = roundMoney(bankCashFlow.totalInflows);
  const totalBankOutflows = roundMoney(bankCashFlow.totalOutflows);
  const subsequentCashFlow = calculateBankCashFlowForAccounts({
    accountIds: input.accounts.map((account) => account.id),
    transactions: (input.subsequentTransactions ?? []).filter((transaction) =>
      isInFinanceScope(transaction, scope),
    ),
    period: {
      ...input.period,
      startDate: input.period.endExclusiveDate,
      endExclusiveDate: "9999-12-31",
    },
  });
  const currentBalance = roundMoney(input.accounts.reduce((sum, account) =>
    sum + account.closingBalance, 0));
  const closingBalance = roundMoney(currentBalance - subsequentCashFlow.netMovement);
  const openingBalance = roundMoney(closingBalance - (totalIncome - totalBankOutflows));
  const reimbursements = calculateReimbursements(input.allocations);
  const totalCardConsumption = calculateCardConsumption(purchases);
  const thirdPartyCardConsumption = calculateThirdPartyConsumption(purchases);
  const personalCardConsumption = roundMoney(totalCardConsumption - thirdPartyCardConsumption);
  const totalRealIncome = roundMoney(result.entries.filter(isRealIncomeEntry).reduce((sum, entry) => sum + entry.amount, 0));
  const history = input.historicalSnapshots ?? [];
  const incomePerspective = calculateMonthlyPerspective({
    current: totalRealIncome,
    history: input.incomeHistoricalReference
      ? undefined
      : history.map((item) => item.totals.totalRealIncome ?? item.totals.totalIncome),
    reference: input.incomeHistoricalReference?.median,
    monthsUsed: input.incomeHistoricalReference?.months,
    subject: "income",
  });
  const cardPerspective = calculateMonthlyPerspective({
    current: input.forecastCardInvoice ?? 0,
    history: input.cardInvoiceHistoricalReference
      ? undefined
      : history.map((item) => item.totals.forecastCardInvoice ?? 0),
    reference: input.cardInvoiceHistoricalReference?.median,
    monthsUsed: input.cardInvoiceHistoricalReference?.months,
    subject: "card",
  });
  const categoryTotals = new Map<string, number>();
  for (const entry of result.entries.filter((item) => item.source === "transaction" && item.sourceKind !== "card" && ["expense", "expense_refund"].includes(item.kind))) {
    const signedAmount = entry.kind === "expense_refund" ? -Math.abs(entry.amount) : entry.amount;
    categoryTotals.set(entry.category, roundMoney((categoryTotals.get(entry.category) ?? 0) + signedAmount));
  }
  for (const purchase of purchases) {
    const amount = purchase.personal_share_amount == null
      ? Math.max(0, amountOf(purchase) - Number(purchase.third_party_share_amount ?? 0))
      : Math.abs(Number(purchase.personal_share_amount));
    const categoryValue = purchase.financial_categories as unknown as { name?: string } | Array<{ name?: string }> | null;
    const category = (Array.isArray(categoryValue) ? categoryValue[0]?.name : categoryValue?.name) ?? "Sem categoria";
    categoryTotals.set(category, roundMoney((categoryTotals.get(category) ?? 0) + (purchase.transaction_role === "refund" ? -amount : amount)));
  }
  const personalConsumption = roundMoney(result.realizedExpenses - thirdPartyCardConsumption);
  const positiveCategories = [...categoryTotals].filter(([, amount]) => amount > 0);
  const rawCategoryTotal = positiveCategories.reduce((sum, [, amount]) => sum + amount, 0);
  // Some legacy bank rows mirror card purchases. Reconcile category detail to
  // the authoritative personal-consumption total instead of counting both.
  const categoryScale = rawCategoryTotal > personalConsumption && rawCategoryTotal > 0
    ? personalConsumption / rawCategoryTotal
    : 1;
  const consumptionCategories = positiveCategories.map(([name, rawAmount]) => {
    const amount = roundMoney(rawAmount * categoryScale);
    return { name, amount, share: personalConsumption > 0 ? Math.round((amount / personalConsumption) * 1000) / 10 : 0 };
  }).sort((left, right) => right.amount - left.amount);
  const futureCommitments = input.futureCommitmentMonths ?? [];
  const futureWithin = (months: number) => roundMoney(futureCommitments.slice(0, months).reduce((sum, item) => sum + item.amount, 0));
  const validation = validateMonthlyClosing({ ...input, purchases, allocations: input.allocations });
  const snapshot: MonthlyReportSnapshot = {
    schemaVersion: 2,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    tracking: {
      startedAt: input.tracking?.startedAt ?? input.period.startInstant,
      availableDataStartAt: input.tracking?.availableDataStartAt ?? input.period.startInstant,
      isFirstFinancialReport: Boolean(input.tracking?.isFirstFinancialReport),
      isPartialInitialMonth: Boolean(input.tracking?.isPartialInitialMonth),
      reportOrigin: input.tracking?.reportOrigin ?? "live_tracked",
    },
    period: input.period,
    totals: {
      openingBalance,
      closingBalance,
      totalIncome,
      totalRealIncome,
      totalBankInflows: totalIncome,
      totalBankOutflows,
      cashResult: roundMoney(totalIncome - totalBankOutflows),
      personalConsumption,
      totalCardConsumption,
      personalCardConsumption,
      forecastCardInvoice: roundMoney(input.forecastCardInvoice ?? 0),
      thirdPartyCardConsumption,
      reimbursementsReceived: reimbursements.received,
      reimbursementsPending: reimbursements.pending,
      futureCommitments: roundMoney(input.futureCommitments ?? 0),
      futureCommitments30d: futureWithin(1),
      futureCommitments60d: futureWithin(2),
      futureCommitments90d: futureWithin(3),
    },
    accounts: input.accounts,
    statements: input.statements,
    entries: result.entries,
    allocations: input.allocations,
    issues: validation.issues,
    narrative: buildMonthlyNarrative({ cashResult: roundMoney(totalIncome - totalBankOutflows), closingBalance, personalConsumption, bankOutflows: totalBankOutflows, incomePerspective }),
    incomePerspective,
    cardPerspective,
    consumptionCategories,
    cashFlow: bankCashFlow.dailySeries.map((point) => ({ date: point.date, label: point.date.slice(8, 10), dailyInflow: point.inflow, dailyOutflow: point.outflow, cumulativeInflow: point.cumulativeInflow, cumulativeOutflow: point.cumulativeOutflow })),
    highlights: { largestInflow: bankCashFlow.largestInflow, largestOutflow: bankCashFlow.largestOutflow, movementCount: bankCashFlow.inflowCount + bankCashFlow.outflowCount, largestRealIncome: Math.max(0, ...result.entries.filter(isRealIncomeEntry).map((entry) => entry.amount)) },
    futureCommitments,
    loans: input.loans ?? [],
  };
  return snapshot;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function hashMonthlySnapshot(snapshot: MonthlyReportSnapshot) {
  // generatedAt is metadata, not financial content. Excluding it makes a
  // repeated close request idempotent even when both clicks start together.
  return createHash("sha256").update(stableJson({ ...snapshot, generatedAt: null })).digest("hex");
}

export function nextMonthlyReportVersion(versions: Array<{ version: number }>) {
  return Math.max(0, ...versions.map((item) => item.version)) + 1;
}

export function shouldReuseClosedReport(input: {
  monthStatus: FinancialMonthStatus;
  currentSnapshotHash?: string | null;
  requestedSnapshotHash: string;
}) {
  return input.monthStatus === "closed" &&
    Boolean(input.currentSnapshotHash) &&
    input.currentSnapshotHash === input.requestedSnapshotHash;
}

export const MonthlyFinancialReportService = {
  getMonthlyPeriod,
  getMonthlyCardTransactions,
  calculateStatementReconciliation,
  calculateCardConsumption,
  calculateThirdPartyConsumption,
  calculatePersonalConsumption,
  calculateReimbursements,
  calculateMonthlyPerspective,
  buildMonthlyNarrative,
  isRealIncomeEntry,
  buildMonthlySnapshot,
  validateMonthlyClosing,
  hashMonthlySnapshot,
  nextMonthlyReportVersion,
  shouldReuseClosedReport,
  availableFinancialMonths,
  isBeforeFinancialTracking,
};
