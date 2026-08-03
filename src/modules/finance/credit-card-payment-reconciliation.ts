import type { FinancialTransaction } from "./types";

export const CARD_PAYMENT_RECONCILIATION_ABSOLUTE_TOLERANCE = 1;
export const CARD_PAYMENT_RECONCILIATION_PERCENT_TOLERANCE = 0.001;

export type StatementPaymentConfirmationStatus =
  | "open"
  | "estimated"
  | "payment_detected"
  | "partially_paid"
  | "paid"
  | "overpaid"
  | "payment_mismatch"
  | "manually_confirmed"
  | "cancelled";

export type StatementPayment = {
  id: string;
  bankTransactionId: string | null;
  allocatedAmount: number;
  paymentDate: string;
  paymentSource:
    | "bank_transaction"
    | "multiple_bank_transactions"
    | "direct_third_party_payment"
    | "manual_confirmation"
    | "legacy_pdf_confirmation"
    | "integration_bill";
  isManual: boolean;
  isThirdParty?: boolean;
};

export type ReconciliationStatement = {
  id: string;
  cardId: string;
  expectedAmount: number;
  dueDate: string;
  closingDate: string;
  cancelled?: boolean;
};

export type PaymentCandidate = {
  statementId: string;
  transactionId: string;
  score: number;
  confidence: "high" | "medium" | "low";
  reasons: string[];
};

const money = (value: number) =>
  Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;

const normalized = (value: string | null | undefined) =>
  (value ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[_-]+/g, " ")
    .toLocaleUpperCase("pt-BR");

const dateOnly = (value: string | null | undefined) => value?.slice(0, 10) ?? null;

export function identifyCreditCardPaymentTransaction(
  transaction: FinancialTransaction,
) {
  const text = normalized(
    `${transaction.description} ${transaction.provider_category ?? ""} ${transaction.operation_type ?? ""} ${transaction.operation_type_additional_info ?? ""}`,
  );
  const explicitlyLinked = Boolean(
    transaction.invoice_id || transaction.credit_card_id,
  );
  const classified =
    transaction.transaction_role === "invoice_payment" ||
    transaction.cash_flow_kind === "invoice_payment" ||
    transaction.financial_nature === "invoice_payment";
  const descriptionMatch =
    /(?:PAGAMENTO|PGTO).*(?:FATURA|CARTAO|CARTAO DE CREDITO|MASTER|VISA)|CREDIT CARD PAYMENT/.test(
      text,
    );
  const effective = !["cancelled", "pending", "forecast", "failed"].includes(
    transaction.status,
  );
  const outflow =
    transaction.bank_direction === "outflow" ||
    Number(transaction.original_amount ?? 0) < 0 ||
    transaction.transaction_type === "expense" ||
    transaction.transaction_role === "invoice_payment";
  const confidence = explicitlyLinked && classified
    ? "high"
    : classified && descriptionMatch
      ? "high"
      : classified || descriptionMatch
        ? "medium"
        : "low";
  return {
    isCandidate: effective && outflow && (classified || descriptionMatch),
    confidence,
    paymentDate:
      dateOnly(transaction.user_effective_at) ??
      dateOnly(transaction.effective_at) ??
      dateOnly(transaction.bank_posted_at) ??
      dateOnly(transaction.provider_posted_at) ??
      dateOnly(transaction.realized_at) ??
      dateOnly(transaction.competence_date),
    amount: money(Math.abs(Number(transaction.amount) || 0)),
    explicitlyLinked,
  } as const;
}

function daysBetween(left: string, right: string) {
  return Math.round(
    Math.abs(new Date(`${left}T12:00:00Z`).valueOf() - new Date(`${right}T12:00:00Z`).valueOf()) /
      86_400_000,
  );
}

export function findCreditCardPaymentCandidates(input: {
  transaction: FinancialTransaction;
  statements: ReconciliationStatement[];
}) {
  const identified = identifyCreditCardPaymentTransaction(input.transaction);
  if (!identified.isCandidate || !identified.paymentDate) return [];
  const identifiedPaymentDate = identified.paymentDate;
  return input.statements.flatMap((statement): PaymentCandidate[] => {
    if (statement.cancelled) return [];
    const reasons: string[] = [];
    let score = 0;
    if (input.transaction.invoice_id === statement.id) {
      score += 70;
      reasons.push("fatura vinculada");
    }
    if (input.transaction.credit_card_id === statement.cardId) {
      score += 35;
      reasons.push("cartão vinculado");
    }
    const amountDifference = Math.abs(identified.amount - statement.expectedAmount);
    const tolerance = statementPaymentTolerance(statement.expectedAmount);
    if (amountDifference <= tolerance) {
      score += 25;
      reasons.push("valor compatível");
    } else if (amountDifference <= Math.max(10, statement.expectedAmount * 0.05)) {
      score += 10;
      reasons.push("valor próximo");
    }
    const dueDistance = daysBetween(identifiedPaymentDate, statement.dueDate);
    if (dueDistance <= 7) {
      score += 20;
      reasons.push("data próxima ao vencimento");
    } else if (dueDistance <= 35) {
      score += 8;
      reasons.push("data no intervalo da fatura");
    }
    if (identified.confidence === "high") score += 10;
    if (score < 20) return [];
    return [{
      statementId: statement.id,
      transactionId: input.transaction.id,
      score,
      confidence: score >= 80 ? "high" : score >= 50 ? "medium" : "low",
      reasons,
    }];
  }).sort((left, right) => right.score - left.score);
}

export function statementPaymentTolerance(expectedAmount: number) {
  if (expectedAmount <= 0) return 0.01;
  return Math.max(
    0.01,
    Math.min(
      CARD_PAYMENT_RECONCILIATION_ABSOLUTE_TOLERANCE,
      expectedAmount * CARD_PAYMENT_RECONCILIATION_PERCENT_TOLERANCE,
    ),
  );
}

export function calculateStatementPaidAmount(payments: StatementPayment[]) {
  return money(payments.reduce(
    (total, payment) => total + Math.abs(payment.allocatedAmount),
    0,
  ));
}

export function calculateStatementPaymentStatus(input: {
  expectedAmount: number;
  payments: StatementPayment[];
  statementOpen?: boolean;
  cancelled?: boolean;
  manuallyConfirmed?: boolean;
}) {
  if (input.cancelled) return "cancelled" as const;
  const paid = calculateStatementPaidAmount(input.payments);
  if (!paid) return input.statementOpen ? "open" as const : "estimated" as const;
  if (input.manuallyConfirmed) return "manually_confirmed" as const;
  const expected = money(Math.max(0, input.expectedAmount));
  if (!expected) return "payment_detected" as const;
  const difference = money(paid - expected);
  const tolerance = statementPaymentTolerance(expected);
  if (Math.abs(difference) <= tolerance) return "paid" as const;
  if (difference > tolerance) return "overpaid" as const;
  return "partially_paid" as const;
}

export function calculateStatementPersonalShare(input: {
  confirmedPaymentAmount: number;
  thirdPartyShare: number;
}) {
  return money(Math.max(0, input.confirmedPaymentAmount - input.thirdPartyShare));
}

export function calculateThirdPartyShare(payments: StatementPayment[]) {
  return money(payments
    .filter(payment => payment.isThirdParty || payment.paymentSource === "direct_third_party_payment")
    .reduce((total, payment) => total + Math.abs(payment.allocatedAmount), 0));
}

export function calculateNetPersonalCardCost(input: {
  grossCardPayment: number;
  reimbursementsReceived: number;
  directThirdPartyPayments: number;
}) {
  return money(Math.max(
    0,
    input.grossCardPayment -
      input.reimbursementsReceived -
      input.directThirdPartyPayments,
  ));
}

export function calculateOpenStatementForecast(input: {
  currentAmount: number;
  personalShare: number | null;
  thirdPartyShare: number | null;
}) {
  const currentAmount = money(Math.max(0, input.currentAmount));
  const thirdPartyShare = money(Math.max(0, input.thirdPartyShare ?? 0));
  const personalShare = input.personalShare == null
    ? money(Math.max(0, currentAmount - thirdPartyShare))
    : money(Math.max(0, input.personalShare));
  return { currentAmount, personalShare, thirdPartyShare };
}

export function calculateNextIncomeCommitment(input: {
  openStatementPersonalShare: number;
  recurringCommitments: number;
  loans: number;
  otherConfirmedCommitments: number;
  expectedIncome: number | null;
}) {
  const amount = money(
    input.openStatementPersonalShare +
      input.recurringCommitments +
      input.loans +
      input.otherConfirmedCommitments,
  );
  return {
    amount,
    percentage: input.expectedIncome && input.expectedIncome > 0
      ? Math.round((amount / input.expectedIncome) * 1000) / 10
      : null,
    incomeEstimated: input.expectedIncome == null,
  };
}

export function buildMonthlyCardCashSummary(input: {
  statements: Array<{
    expectedAmount: number;
    payments: StatementPayment[];
    personalShare: number;
    thirdPartyShare: number;
  }>;
  reimbursementsReceived: number;
  reimbursementsPending: number;
  unmatchedBankPayments?: StatementPayment[];
}) {
  const allPayments = input.statements.flatMap(statement => statement.payments);
  const bankPayments = allPayments.filter(payment =>
    payment.bankTransactionId && payment.paymentSource !== "direct_third_party_payment");
  const confirmedTransactionIds = new Set(bankPayments
    .map(payment => payment.bankTransactionId)
    .filter((id): id is string => Boolean(id)));
  const unmatchedBankPayments = [...new Map((input.unmatchedBankPayments ?? [])
    .filter(payment => payment.bankTransactionId &&
      !confirmedTransactionIds.has(payment.bankTransactionId))
    .map(payment => [payment.bankTransactionId, payment])).values()];
  const cashBankPayments = [...bankPayments, ...unmatchedBankPayments];
  const directThirdPartyPayments = calculateThirdPartyShare(allPayments);
  const grossCardPayment = calculateStatementPaidAmount(cashBankPayments);
  const totalSettled = calculateStatementPaidAmount([
    ...allPayments,
    ...unmatchedBankPayments,
  ]);
  const netPersonalCardCost = calculateNetPersonalCardCost({
    grossCardPayment: totalSettled,
    reimbursementsReceived: input.reimbursementsReceived,
    directThirdPartyPayments,
  });
  return {
    grossCardPayment,
    totalSettled,
    directThirdPartyPayments,
    reimbursementsReceived: money(input.reimbursementsReceived),
    reimbursementsPending: money(input.reimbursementsPending),
    netPersonalCardCost,
  };
}
