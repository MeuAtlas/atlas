import {
  calculateMonthlyFinancialResult,
  isInFinanceScope,
  resolveFinanceMonthPeriod,
  type FinanceCalculationScope,
  type FinanceMonthPeriod,
} from "./monthly-result";
import type {
  CardPurchase,
  FinanceSummary,
  FinancialAccount,
  FinancialTransaction,
} from "./types";

const money = (value: number | string | null | undefined) =>
  Math.abs(Number(value ?? 0));

export function isRealized(transaction: FinancialTransaction) {
  return ["realized", "completed", "paid", "received"].includes(
    transaction.status,
  );
}

export function isIncome(transaction: FinancialTransaction) {
  return transaction.transaction_type === "income";
}

export function isExpense(transaction: FinancialTransaction) {
  return transaction.transaction_type === "expense";
}

export function countsAsIncomeOrExpense(transaction: FinancialTransaction) {
  return !["invoice_payment", "transfer", "adjustment"].includes(
    transaction.transaction_role,
  );
}

export function hasDefinitiveTarget(transaction: FinancialTransaction) {
  if (transaction.review_status && transaction.review_status !== "reviewed") {
    return false;
  }
  if (transaction.source_type === "payroll") {
    return Boolean(
      transaction.loan_id ||
        transaction.recurring_rule_id ||
        transaction.external_id,
    );
  }
  if (transaction.transaction_role === "invoice_payment") {
    return Boolean(
      transaction.account_id &&
        (transaction.credit_card_id || transaction.invoice_id),
    );
  }
  if (transaction.transaction_role === "transfer") {
    return Boolean(
      transaction.account_id &&
        transaction.destination_account_id &&
        transaction.account_id !== transaction.destination_account_id,
    );
  }
  return Boolean(
    transaction.account_id ||
      transaction.credit_card_id ||
      transaction.invoice_id ||
      transaction.loan_id ||
      transaction.recurring_rule_id,
  );
}

export function cardConsumptionTotal(purchases: CardPurchase[]) {
  return purchases.reduce(
    (sum, purchase) =>
      purchase.transaction_role === "refund"
        ? sum - money(purchase.installment_amount)
        : purchase.transaction_role === "consumption"
          ? sum + money(purchase.installment_amount)
          : sum,
    0,
  );
}

export function summarizeFinance(
  accounts: FinancialAccount[],
  transactions: FinancialTransaction[],
  purchases: CardPurchase[] = [],
  today = new Date(),
  options: {
    period?: FinanceMonthPeriod;
    timeZone?: string;
    scope?: FinanceCalculationScope;
  } = {},
): FinanceSummary {
  const period =
    options.period ??
    resolveFinanceMonthPeriod({
      referenceDate: today,
      timeZone: options.timeZone,
    });
  const scope = options.scope ?? {};
  const monthly = calculateMonthlyFinancialResult({
    transactions,
    purchases,
    period,
    scope,
  });
  const available = accounts
    .filter(
      (account) =>
        isInFinanceScope(account, scope) &&
        account.status === "active" &&
        account.account_type !== "investment",
    )
    .reduce((sum, account) => sum + Number(account.current_balance ?? 0), 0);
  const todayKey = today.toISOString().slice(0, 10);
  const overdue = transactions
    .filter(
      (transaction) =>
        isInFinanceScope(transaction, scope) &&
        hasDefinitiveTarget(transaction) &&
        countsAsIncomeOrExpense(transaction) &&
        transaction.due_date &&
        transaction.due_date < todayKey &&
        ["forecast", "pending", "partial", "overdue"].includes(
          transaction.status,
        ),
    )
    .reduce((sum, transaction) => sum + money(transaction.amount), 0);

  return {
    monthStart: period.startDate,
    monthEndExclusive: period.endExclusiveDate,
    available,
    income: monthly.realizedRevenue,
    expenses: monthly.realizedExpenses,
    receivable: monthly.expectedRevenue,
    payable: monthly.expectedExpenses,
    overdue,
    monthlyResult: monthly.monthlyResult,
    projected:
      available + monthly.expectedRevenue - monthly.expectedExpenses,
  };
}
