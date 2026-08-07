import { createHash } from "node:crypto";

import {
  calculateMonthlyFinancialResult,
  financialCompetenceDate,
  getFinanceMonthPeriod,
  isInFinanceScope,
  type FinanceCalculationScope,
  type FinanceMonthPeriod,
} from "./monthly-result";
import {
  bankMovementDate,
  calculateBankCashFlowForAccounts,
  resolveBankTransactionDirection,
} from "./account-movement";
import {
  buildMonthlyCardCashSummary,
  calculateNextIncomeCommitment,
  calculateOpenStatementForecast,
  type StatementPaymentConfirmationStatus,
} from "./credit-card-payment-reconciliation";
import type { CardPurchase, FinancialTransaction } from "./types";

export const MONTH_REPORT_TIME_ZONE = "America/Fortaleza";

export type FinancialMonthStatus =
  | "planned"
  | "open"
  | "awaiting_consolidation"
  | "review"
  | "needs_attention"
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
  official_amount_source?: string | null;
  closing_date: string;
  due_date: string;
  cycle_start_date?: string | null;
  cycle_end_date?: string | null;
  statement_file_path?: string | null;
  pdf_document_id?: string | null;
  reference_month?: string | null;
  expected_statement_amount: number;
  current_open_amount: number;
  detected_payment_amount: number;
  confirmed_payment_amount: number;
  payment_difference: number | null;
  payment_confirmation_status: StatementPaymentConfirmationStatus;
  payment_confirmation_source: string | null;
  payment_confirmed_at: string | null;
  statement_status: string;
  personal_share_amount: number;
  third_party_share_amount: number;
  third_party_people: Array<{
    name: string;
    amount: number;
    installment_purchase_count: number;
    installment_total_amount: number;
  }>;
  personal_installment_purchase_count: number;
  personal_installment_total_amount: number;
  installment_purchase_count: number;
  installment_total_amount: number;
  payments: MonthlyStatementPayment[];
};

export type MonthlyStatementPayment = {
  id: string;
  bankTransactionId: string | null;
  allocatedAmount: number;
  paymentDate: string;
  paymentSource: "bank_transaction" | "multiple_bank_transactions" |
    "direct_third_party_payment" | "manual_confirmation" |
    "legacy_pdf_confirmation" | "integration_bill";
  isManual: boolean;
  isThirdParty: boolean;
  description?: string | null;
  accountName?: string | null;
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
  schemaVersion: 1 | 2 | 3;
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
  paidStatements?: MonthlyStatement[];
  openStatements?: MonthlyStatement[];
  statementPayments?: MonthlyStatementPayment[];
  paymentReconciliation?: {
    confirmed: number;
    partial: number;
    mismatched: number;
    unmatchedCandidates: number;
  };
  cashCardOutflow?: number;
  netPersonalCardCost?: number;
  nextMonthCardCommitment?: number;
  nextIncomeCommitment?: number;
  nextIncomeCommitmentPercentage?: number | null;
  bankMovements?: Array<{
    id: string;
    date: string;
    description: string;
    amount: number;
    direction: "inflow" | "outflow";
    accountName: string;
    transactionRole: string | null;
  }>;
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
  incomeBreakdown?: Array<{ name: string; amount: number }>;
  recurringCommitments?: {
    total: number;
    incomeShare: number | null;
    items: Array<{ name: string; amount: number; group: string }>;
  };
  householdCost?: { total: number; items: Array<{ name: string; amount: number }> };
  dependentsCost?: { total: number; people: Array<{ name: string; total: number; items: Array<{ name: string; amount: number }> }> };
  thirdPartySummary?: Array<{ personId: string; personName: string; total: number; received: number; pending: number }>;
  installments?: {
    chargedNow: number;
    paid: number;
    remaining: number;
    items: Array<{ id: string; description: string; current: number; total: number; amount: number; paid: number; remaining: number; endsAt: string; responsibleName?: string | null }>;
  };
  projection?: Array<{ month: string; total: number; installments: number; recurring: number; other: number; card?: number }>;
  attention?: string[];
  documents?: Array<{ type: "card_statement" | "monthly_report"; name: string; path: string | null }>;
  syncInformation?: Array<{ accountId: string; lastSyncAt: string | null }>;
  calculationRulesVersion?: string;
};

export type MonthlyRecurringGroup = {
  name: string;
  type: "own" | "dependent" | "household" | "work" | "travel";
  total: number;
  items: Array<{ name: string; amount: number }>;
};

export type MonthlyDependentCostSummary = {
  name: string;
  isDependent: boolean;
  actualSpentCents: number;
  projectedCommitmentsCents: number;
};

export function mergeDependentCostsIntoRecurringGroups(
  groups: MonthlyRecurringGroup[],
  people: MonthlyDependentCostSummary[],
): MonthlyRecurringGroup[] {
  const merged = groups.map(group => ({
    ...group,
    items: group.items.map(item => ({ ...item })),
  }));
  for (const person of people.filter(item => item.isDependent)) {
    const total = roundMoney(
      (person.actualSpentCents + person.projectedCommitmentsCents) / 100,
    );
    const existing = merged.find(group =>
      group.type === "dependent" && group.name === person.name
    );
    if (!existing) {
      if (total > 0) merged.push({
        name: person.name,
        type: "dependent",
        total,
        items: [{ name: "Extras e outras despesas", amount: total }],
      });
      continue;
    }
    const represented = roundMoney(existing.items.reduce(
      (sum, item) => sum + item.amount,
      0,
    ));
    const extra = roundMoney(total - represented);
    existing.total = total;
    if (extra > 0) {
      existing.items.push({ name: "Extras e outras despesas", amount: extra });
    }
  }
  return merged;
}

export type MonthlyInstallment = {
  id: string;
  description: string;
  current: number;
  total: number;
  amount: number;
  paid: number;
  remaining: number;
  endsAt: string;
  responsibleName?: string | null;
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
  const history = (input.history ?? []).slice(-6);
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
  const subject = input.subject === "income" ? "Sua renda" : "O pagamento do cartão";
  const message = reference == null || percentageDifference == null
    ? "Ainda não há dados históricos suficientes para esta comparação."
    : Math.abs(percentageDifference) <= 5
      ? `${subject} ficou próximo do padrão recente.`
      : percentageDifference > 5
        ? input.subject === "income" ? "Você recebeu mais que a sua referência recente." : "O pagamento do cartão ficou acima do padrão recente."
        : input.subject === "income" ? "Você recebeu menos que a sua referência recente." : "O pagamento do cartão ficou abaixo do padrão recente.";
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
  if (now < new Date(period.startInstant)) return "planned" as const;
  if (persistedStatus === "planned" && now < new Date(period.endExclusiveInstant)) {
    return "open" as const;
  }
  if (now < new Date(period.endExclusiveInstant)) return "open" as const;
  if (recommendedCloseAt && now < new Date(recommendedCloseAt)) {
    return "awaiting_consolidation" as const;
  }
  if (persistedStatus === "review" || persistedStatus === "needs_attention") return persistedStatus;
  return "awaiting_consolidation" as const;
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
  expectedStatementCount?: number;
  openStatements?: MonthlyStatement[];
  unmatchedPaymentCount?: number;
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
    if (statement.payment_confirmation_status === "partially_paid") {
      issues.push({ key: `statement:${statement.id}:partial`, type: "statement_partially_paid", severity: "blocking", title: `A fatura de ${statement.card_name} foi paga parcialmente`, description: "Confirme como o saldo restante será tratado antes de concluir.", relatedEntityType: "card_invoice", relatedEntityId: statement.id, amount: Math.max(0, statement.expected_statement_amount - statement.confirmed_payment_amount) });
    } else if (["payment_detected", "payment_mismatch", "overpaid"].includes(statement.payment_confirmation_status)) {
      issues.push({ key: `statement:${statement.id}:payment-review`, type: "statement_payment_review", severity: "blocking", title: `O pagamento da fatura de ${statement.card_name} precisa de conferência`, description: "Revise o vínculo ou explique a diferença encontrada no pagamento.", relatedEntityType: "card_invoice", relatedEntityId: statement.id, amount: statement.payment_difference ?? undefined });
    }
    if (!statement.statement_file_path) {
      issues.push({ key: `statement:${statement.id}:pdf-optional`, type: "statement_pdf_optional", severity: "warning", title: `PDF opcional não anexado para ${statement.card_name}`, description: "O pagamento bancário confirma o valor. O PDF serve apenas para detalhamento e auditoria.", relatedEntityType: "card_invoice", relatedEntityId: statement.id });
    }
  }
  for (const statement of (input.openStatements ?? []).filter(statement => !isStatementSettled(statement))) {
    issues.push({ key: `statement:${statement.id}:open-forecast`, type: "open_statement_forecast", severity: "warning", title: `A próxima fatura de ${statement.card_name} ainda pode mudar`, description: "Ela não é saída deste mês e aparece apenas como compromisso futuro.", relatedEntityType: "card_invoice", relatedEntityId: statement.id, amount: statement.current_open_amount });
  }
  if ((input.unmatchedPaymentCount ?? 0) > 0) {
    issues.push({ key: "unmatched_card_payment", type: "unmatched_card_payment", severity: "blocking", title: "Há pagamento de fatura sem vínculo confirmado", description: "Encontramos um débito de cartão que precisa ser associado à fatura correta." });
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

export function isStatementSettled(statement: Pick<MonthlyStatement, "payment_confirmation_status" | "confirmed_payment_amount" | "official_total_amount" | "expected_statement_amount" | "current_open_amount">) {
  const expected = statement.official_total_amount ?? statement.expected_statement_amount ?? statement.current_open_amount;
  return statement.payment_confirmation_status === "paid" ||
    (expected > 0 && statement.confirmed_payment_amount >= expected);
}

export function buildMonthlySnapshot(input: {
  period: FinanceMonthPeriod;
  generatedAt?: string;
  transactions: FinancialTransaction[];
  subsequentTransactions?: FinancialTransaction[];
  purchases: MonthlyCardPurchase[];
  statements: MonthlyStatement[];
  openStatements?: MonthlyStatement[];
  unmatchedPaymentCount?: number;
  unmatchedCardPayments?: MonthlyStatementPayment[];
  allocations: MonthlyAllocation[];
  accounts: Array<{ id: string; name: string; openingBalance: number; closingBalance: number; lastSyncAt?: string | null }>;
  forecastCardInvoice?: number;
  futureCommitments?: number;
  status: FinancialMonthStatus;
  scope?: FinanceCalculationScope;
  accountsSyncHealthy?: boolean;
  expectedStatementCount?: number;
  historicalSnapshots?: MonthlyReportSnapshot[];
  incomeHistoricalReference?: { median: number | null; months: number };
  cardInvoiceHistoricalReference?: { median: number | null; months: number };
  futureCommitmentMonths?: Array<{ month: string; amount: number }>;
  recurringGroups?: MonthlyRecurringGroup[];
  installments?: MonthlyInstallment[];
  futureInstallments?: Array<{ month: string; amount: number }>;
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
  const paidStatements = input.statements.filter(statement => statement.payments.length > 0);
  const openStatements = input.openStatements ?? [];
  const outstandingOpenStatements = openStatements.filter(statement => !isStatementSettled(statement));
  const cardCashSummary = buildMonthlyCardCashSummary({
    statements: paidStatements.map(statement => ({
      expectedAmount: statement.expected_statement_amount,
      payments: statement.payments,
      personalShare: statement.personal_share_amount,
      thirdPartyShare: statement.third_party_share_amount,
    })),
    reimbursementsReceived: reimbursements.received,
    reimbursementsPending: reimbursements.pending,
    unmatchedBankPayments: input.unmatchedCardPayments,
  });
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
    current: cardCashSummary.grossCardPayment,
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
  const openStatementPersonalShare = roundMoney(outstandingOpenStatements.reduce((sum, statement) => {
    const forecast = calculateOpenStatementForecast({
      currentAmount: statement.current_open_amount || statement.expected_statement_amount,
      personalShare: statement.personal_share_amount || null,
      thirdPartyShare: statement.third_party_share_amount || null,
    });
    return sum + forecast.personalShare;
  }, 0));
  const nextIncome = calculateNextIncomeCommitment({
    openStatementPersonalShare,
    recurringCommitments: futureCommitments[0]?.amount ?? 0,
    loans: 0,
    otherConfirmedCommitments: 0,
    expectedIncome: input.incomeHistoricalReference?.median ?? null,
  });
  const futureWithin = (months: number) => roundMoney(futureCommitments.slice(0, months).reduce((sum, item) => sum + item.amount, 0));
  const validation = validateMonthlyClosing({ ...input, purchases, allocations: input.allocations, openStatements });
  const incomeBreakdownMap = new Map<string, number>();
  for (const entry of result.entries.filter(isRealIncomeEntry)) {
    incomeBreakdownMap.set(entry.category, roundMoney((incomeBreakdownMap.get(entry.category) ?? 0) + entry.amount));
  }
  const recurringGroups = input.recurringGroups ?? [];
  const recurringItems = recurringGroups.flatMap((group) => group.items.map((item) => ({ ...item, group: group.name })));
  const recurringTotal = roundMoney(recurringGroups.reduce((sum, group) => sum + group.total, 0));
  const householdGroups = recurringGroups.filter((group) => group.type === "household");
  const dependentGroups = recurringGroups.filter((group) => group.type === "dependent");
  const thirdPartyMap = new Map<string, { personId: string; personName: string; total: number; received: number; pending: number }>();
  for (const allocation of input.allocations) {
    const current = thirdPartyMap.get(allocation.person_id) ?? { personId: allocation.person_id, personName: allocation.person_name ?? "Outra pessoa", total: 0, received: 0, pending: 0 };
    current.total = roundMoney(current.total + Number(allocation.reimbursable_amount || allocation.allocated_amount || 0));
    current.received = roundMoney(current.received + Number(allocation.reimbursed_amount || 0));
    current.pending = roundMoney(current.pending + Number(allocation.pending_reimbursement_amount || 0));
    thirdPartyMap.set(allocation.person_id, current);
  }
  const installmentItems = input.installments ?? [];
  const futureInstallmentMap = new Map((input.futureInstallments ?? []).map((item) => [item.month.slice(0, 7), item.amount]));
  const projection = futureCommitments.slice(0, 3).map((item, index) => {
    const installments = roundMoney(futureInstallmentMap.get(item.month.slice(0, 7)) ?? 0);
    const recurring = roundMoney(Math.min(item.amount, recurringTotal));
    const card = index === 0 ? openStatementPersonalShare : 0;
    return { month: item.month, total: roundMoney(item.amount + card), installments, recurring, other: roundMoney(Math.max(0, item.amount - recurring)), card };
  });
  const attention = validation.issues.map((issue) => issue.title);
  if ((projection[0]?.total ?? 0) > closingBalance) attention.push("O prÃ³ximo mÃªs jÃ¡ comeÃ§a com compromissos acima do saldo final deste mÃªs.");
  if (reimbursements.pending > 0) attention.push(`Ainda faltam ${new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(reimbursements.pending)} de terceiros para entrar.`);
  if ((cardPerspective.percentageDifference ?? 0) > 5) attention.push("Seu cartÃ£o ficou acima do padrÃ£o recente.");
  const latestInstallment = installmentItems.map((item) => item.endsAt).sort().at(-1);
  if (latestInstallment) attention.push(`HÃ¡ parcelamentos que continuam atÃ© ${latestInstallment.slice(0, 7).split("-").reverse().join("/")}.`);
  const effectiveStatuses = new Set(["realized", "completed", "posted", "settled", "paid", "received"]);
  const accountNames = new Map(input.accounts.map(account => [account.id, account.name]));
  const bankMovements = scopedTransactions.flatMap(transaction => {
    if (!effectiveStatuses.has(transaction.status)) return [];
    const accountId = transaction.account_id && accountNames.has(transaction.account_id)
      ? transaction.account_id
      : transaction.destination_account_id && accountNames.has(transaction.destination_account_id)
        ? transaction.destination_account_id
        : null;
    if (!accountId) return [];
    const date = bankMovementDate(transaction, input.period.timeZone);
    if (!date || date < input.period.startDate || date >= input.period.endExclusiveDate) return [];
    const direction = resolveBankTransactionDirection(transaction, accountId);
    if (direction === "unknown") return [];
    return [{ id: transaction.id, date, description: transaction.description,
      amount: Math.abs(Number(transaction.amount) || 0), direction,
      accountName: accountNames.get(accountId) ?? "Conta bancária",
      transactionRole: transaction.transaction_role ?? null }];
  }).sort((left, right) => left.date.localeCompare(right.date));
  const snapshot: MonthlyReportSnapshot = {
    schemaVersion: 3,
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
    paidStatements,
    openStatements,
    statementPayments: paidStatements.flatMap(statement => statement.payments),
    paymentReconciliation: {
      confirmed: paidStatements.filter(statement => ["paid", "manually_confirmed"].includes(statement.payment_confirmation_status)).length,
      partial: paidStatements.filter(statement => statement.payment_confirmation_status === "partially_paid").length,
      mismatched: paidStatements.filter(statement => ["overpaid", "payment_mismatch"].includes(statement.payment_confirmation_status)).length,
      unmatchedCandidates: input.unmatchedPaymentCount ?? 0,
    },
    cashCardOutflow: cardCashSummary.grossCardPayment,
    netPersonalCardCost: cardCashSummary.netPersonalCardCost,
    nextMonthCardCommitment: openStatementPersonalShare,
    nextIncomeCommitment: nextIncome.amount,
    nextIncomeCommitmentPercentage: nextIncome.percentage,
    bankMovements,
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
    incomeBreakdown: [...incomeBreakdownMap].map(([name, amount]) => ({ name, amount })).sort((left, right) => right.amount - left.amount),
    recurringCommitments: { total: recurringTotal, incomeShare: totalRealIncome > 0 ? Math.round((recurringTotal / totalRealIncome) * 1000) / 10 : null, items: recurringItems },
    householdCost: { total: roundMoney(householdGroups.reduce((sum, group) => sum + group.total, 0)), items: householdGroups.flatMap((group) => group.items) },
    dependentsCost: { total: roundMoney(dependentGroups.reduce((sum, group) => sum + group.total, 0)), people: dependentGroups.map((group) => ({ name: group.name, total: group.total, items: group.items })) },
    thirdPartySummary: [...thirdPartyMap.values()].sort((left, right) => right.total - left.total),
    installments: {
      chargedNow: roundMoney(installmentItems.reduce((sum, item) => sum + item.amount, 0)),
      paid: roundMoney(installmentItems.reduce((sum, item) => sum + item.paid, 0)),
      remaining: roundMoney(installmentItems.reduce((sum, item) => sum + item.remaining, 0)),
      items: installmentItems,
    },
    projection,
    attention: [...new Set(attention)].slice(0, 5),
    documents: input.statements.filter((statement) => statement.statement_file_path).map((statement) => ({ type: "card_statement" as const, name: `Fatura ${statement.card_name}`, path: statement.statement_file_path ?? null })),
    syncInformation: input.accounts.map((account) => ({ accountId: account.id, lastSyncAt: account.lastSyncAt ?? null })),
    calculationRulesVersion: "monthly-report-cash-v4",
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
