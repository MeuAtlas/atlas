import type {
  BankConnectionSummary,
  FinancialAccount,
  FinancialTransaction,
} from "./types";
import {
  shiftFinanceMonth,
  type FinanceMonthPeriod,
} from "./monthly-result";
import { calculateBankAccountCashFlow } from "./bank-cash-flow";

const EFFECTIVE_STATUSES = new Set([
  "realized",
  "completed",
  "posted",
  "settled",
  "paid",
  "received",
]);
const PENDING_STATUSES = new Set(["pending", "partial"]);
const EXCLUDED_STATUSES = new Set([
  "cancelled",
  "deleted",
  "duplicate",
  "failed",
  "draft",
  "rejected",
  "forecast",
  "overdue",
]);
const TRANSACTIONAL_ACCOUNT_TYPES = new Set([
  "checking",
  "current",
  "digital",
  "savings",
  "bank",
  "international",
  "other",
]);

export type AccountMovementDirection =
  | "inflow"
  | "outflow"
  | "ignored"
  | "pending_review";

export type AccountMovementDailyPoint = {
  date: string;
  label: string;
  dailyInflow: number;
  dailyOutflow: number;
  cumulativeInflow: number;
  cumulativeOutflow: number;
};

export type BankAccountMovementItem = {
  id: string;
  externalId: string | null;
  date: string;
  description: string;
  amount: number;
  direction: "inflow" | "outflow";
  nature: string;
  category: string;
  origin: string;
  source: string;
  status: string;
  reviewStatus: string;
  financialRole: string | null;
  classificationSource: string | null;
  classificationConfidence: string | null;
};

export type BankAccountMonthlyMovement = {
  accountId: string;
  accountName: string;
  institutionName: string | null;
  accountType: string;
  source: string;
  currentBalance: number;
  monthStart: string;
  monthEnd: string;
  totalInflow: number;
  totalOutflow: number;
  netMovement: number;
  inflowCount: number;
  outflowCount: number;
  largestInflow: number;
  largestOutflow: number;
  inflowItems: BankAccountMovementItem[];
  outflowItems: BankAccountMovementItem[];
  previousMonthInflow: number;
  previousMonthOutflow: number;
  pendingCount: number;
  ignoredCount: number;
  dailySeries: AccountMovementDailyPoint[];
  lastSyncAt: string | null;
  dataCompleteness: "complete" | "partial" | "stale";
  warnings: string[];
};

function pad(value: number) {
  return String(value).padStart(2, "0");
}

function dateInTimeZone(value: string | null | undefined, timeZone: string) {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) return null;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(parsed);
  const values = Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  return `${values.year}-${values.month}-${values.day}`;
}

/**
 * Bank movement date priority. Provider transaction_date/posted_at are
 * supported when present; current Pluggy imports persist the official date in
 * realized_at and competence_date.
 */
export function bankMovementDate(
  transaction: FinancialTransaction,
  timeZone = "America/Sao_Paulo",
) {
  return (
    dateInTimeZone(transaction.user_effective_at, timeZone) ??
    dateInTimeZone(transaction.effective_at, timeZone) ??
    dateInTimeZone(transaction.bank_posted_at, timeZone) ??
    dateInTimeZone(transaction.provider_posted_at, timeZone) ??
    dateInTimeZone(transaction.transaction_date, timeZone) ??
    dateInTimeZone(transaction.realized_at, timeZone) ??
    dateInTimeZone(transaction.posted_at, timeZone) ??
    dateInTimeZone(transaction.competence_date, timeZone)
  );
}

function isSelectedAccount(
  transaction: FinancialTransaction,
  accountId: string,
) {
  return (
    transaction.account_id === accountId ||
    transaction.destination_account_id === accountId
  );
}

function isBankMovement(transaction: FinancialTransaction) {
  const isInvoicePayment =
    transaction.transaction_role === "invoice_payment" ||
    transaction.cash_flow_kind === "invoice_payment";
  if (
    !isInvoicePayment &&
    (
      transaction.source_type === "card" ||
      transaction.financial_origin === "credit_card" ||
      transaction.transaction_role === "consumption"
    )
  ) {
    return false;
  }
  return Boolean(transaction.account_id || transaction.destination_account_id);
}

function signedProviderAmount(transaction: FinancialTransaction) {
  const original = Number(transaction.original_amount);
  return Number.isFinite(original) && original !== 0 ? original : null;
}

export function resolveBankTransactionDirection(
  transaction: FinancialTransaction,
  accountId?: string,
): "inflow" | "outflow" | "unknown" {
  const isOrigin = accountId && transaction.account_id === accountId;
  const isDestination =
    accountId && transaction.destination_account_id === accountId;
  if (
    accountId &&
    (transaction.transaction_role === "transfer" ||
      transaction.transaction_type === "transfer")
  ) {
    if (isDestination && !isOrigin) return "inflow";
    if (isOrigin && !isDestination) return "outflow";
  }
  if (transaction.bank_direction === "inflow") return "inflow";
  if (transaction.bank_direction === "outflow") return "outflow";

  const providerDirection = [
    transaction.provider_type,
    transaction.operation_type,
  ]
    .filter(Boolean)
    .join(" ")
    .toUpperCase();
  if (/\bCREDIT\b/.test(providerDirection)) return "inflow";
  if (/\bDEBIT\b/.test(providerDirection)) return "outflow";

  const providerAmount = signedProviderAmount(transaction);
  if (providerAmount !== null) {
    return providerAmount > 0 ? "inflow" : "outflow";
  }
  if (
    transaction.transaction_role === "invoice_payment" ||
    transaction.cash_flow_kind === "invoice_payment"
  ) {
    return "outflow";
  }
  if (
    ["loan_proceeds", "investment_redemption", "principal_redemption"]
      .includes(transaction.cash_flow_kind ?? "")
  ) {
    return "inflow";
  }
  if (
    ["investment_contribution", "investment_transfer"]
      .includes(transaction.cash_flow_kind ?? "")
  ) {
    return "outflow";
  }
  if (
    ["income", "refund", "reversal"].includes(transaction.transaction_type)
  ) {
    return "inflow";
  }
  if (transaction.transaction_type === "expense") return "outflow";
  return "unknown";
}

export function classifyBankAccountMovement(
  transaction: FinancialTransaction,
  accountId: string,
): AccountMovementDirection {
  if (
    !isSelectedAccount(transaction, accountId) ||
    !isBankMovement(transaction) ||
    EXCLUDED_STATUSES.has(transaction.status) ||
    transaction.review_status === "ignored"
  ) {
    return "ignored";
  }
  if (PENDING_STATUSES.has(transaction.status)) return "pending_review";
  if (!EFFECTIVE_STATUSES.has(transaction.status)) return "ignored";

  const isOrigin = transaction.account_id === accountId;
  const isDestination = transaction.destination_account_id === accountId;
  if (isOrigin && isDestination) return "ignored";

  if (transaction.bank_direction === "review") return "pending_review";
  const resolved = resolveBankTransactionDirection(transaction, accountId);
  if (resolved !== "unknown") return resolved;
  return transaction.review_status === "pending"
    ? "pending_review"
    : "ignored";
}

function duplicateKey(transaction: FinancialTransaction) {
  return transaction.external_id
    ? `${transaction.source}:${transaction.external_id}`
    : `id:${transaction.id}`;
}

function statusRank(transaction: FinancialTransaction) {
  if (EFFECTIVE_STATUSES.has(transaction.status)) return 2;
  if (PENDING_STATUSES.has(transaction.status)) return 1;
  return 0;
}

function dedupeTransactions(transactions: FinancialTransaction[]) {
  const selected = new Map<string, FinancialTransaction>();
  for (const transaction of transactions) {
    const key = duplicateKey(transaction);
    const current = selected.get(key);
    if (!current || statusRank(transaction) > statusRank(current)) {
      selected.set(key, transaction);
    }
  }
  return [...selected.values()];
}

/** Consolidated physical cash flow for a set of bank accounts. */
export function calculateBankCashFlowForAccounts({
  accountIds,
  transactions,
  period,
}: {
  accountIds: string[];
  transactions: FinancialTransaction[];
  period: FinanceMonthPeriod;
}) {
  const selectedAccounts = new Set(accountIds);
  const entries = [] as Array<{
    id: string;
    date: string;
    amount: number;
    effect: "inflow" | "outflow";
  }>;

  for (const transaction of dedupeTransactions(transactions)) {
    const originSelected = Boolean(
      transaction.account_id && selectedAccounts.has(transaction.account_id),
    );
    const destinationSelected = Boolean(
      transaction.destination_account_id &&
      selectedAccounts.has(transaction.destination_account_id),
    );
    const isTransfer = transaction.transaction_role === "transfer" ||
      transaction.transaction_type === "transfer";
    if (isTransfer && originSelected && destinationSelected) continue;

    const accountId = originSelected
      ? transaction.account_id
      : destinationSelected
        ? transaction.destination_account_id
        : null;
    if (!accountId) continue;

    const direction = classifyBankAccountMovement(transaction, accountId);
    if (direction !== "inflow" && direction !== "outflow") continue;
    const date = bankMovementDate(transaction, period.timeZone);
    if (!date || date < period.startDate || date >= period.endExclusiveDate) continue;
    entries.push({
      id: transaction.id,
      date,
      amount: Math.abs(Number(transaction.amount) || 0),
      effect: direction,
    });
  }

  return calculateBankAccountCashFlow(entries);
}

function movementItem(
  transaction: FinancialTransaction,
  direction: "inflow" | "outflow",
  date: string,
): BankAccountMovementItem {
  return {
    id: transaction.id,
    externalId: transaction.external_id ?? null,
    date,
    description: transaction.description,
    amount: Math.abs(Number(transaction.amount) || 0),
    direction,
    nature:
      transaction.financial_nature ||
      transaction.cash_flow_kind ||
      (direction === "inflow" ? "Crédito bancário" : "Débito bancário"),
    category: transaction.financial_categories?.name || "Sem categoria",
    origin: transaction.source === "pluggy" ? "Pluggy" : "Manual",
    source: transaction.source,
    status: transaction.status,
    reviewStatus: transaction.review_status || "reviewed",
    financialRole: transaction.financial_role ?? null,
    classificationSource: transaction.classification_source ?? null,
    classificationConfidence: transaction.classification_confidence ?? null,
  };
}

function calculatePeriodMovement({
  account,
  transactions,
  period,
  includeSeries,
}: {
  account: FinancialAccount;
  transactions: FinancialTransaction[];
  period: FinanceMonthPeriod;
  includeSeries: boolean;
}) {
  const daysInMonth = new Date(
    Date.UTC(period.year, period.month, 0),
  ).getUTCDate();
  const points = new Map<string, AccountMovementDailyPoint>();
  if (includeSeries) {
    for (let day = 1; day <= daysInMonth; day++) {
      const date = `${period.year}-${pad(period.month)}-${pad(day)}`;
      points.set(date, {
        date,
        label: pad(day),
        dailyInflow: 0,
        dailyOutflow: 0,
        cumulativeInflow: 0,
        cumulativeOutflow: 0,
      });
    }
  }

  const inflowItems: BankAccountMovementItem[] = [];
  const outflowItems: BankAccountMovementItem[] = [];
  let pendingCount = 0;
  let ignoredCount = 0;

  for (const transaction of dedupeTransactions(transactions)) {
    const direction = classifyBankAccountMovement(transaction, account.id);
    const date = bankMovementDate(transaction, period.timeZone);
    if (!date || date < period.startDate || date >= period.endExclusiveDate) {
      if (isSelectedAccount(transaction, account.id)) ignoredCount++;
      continue;
    }
    if (direction === "pending_review") {
      pendingCount++;
      continue;
    }
    if (direction === "ignored") {
      ignoredCount++;
      continue;
    }
    const item = movementItem(transaction, direction, date);
    if (direction === "inflow") inflowItems.push(item);
    else outflowItems.push(item);
  }

  const cashFlow = calculateBankAccountCashFlow([
    ...inflowItems.map(item => ({
      id: item.id,
      date: item.date,
      amount: item.amount,
      effect: "inflow" as const,
    })),
    ...outflowItems.map(item => ({
      id: item.id,
      date: item.date,
      amount: item.amount,
      effect: "outflow" as const,
    })),
  ]);
  const cashByDate = new Map(
    cashFlow.dailySeries.map(point => [point.date, point]),
  );
  let cumulativeInflow = 0;
  let cumulativeOutflow = 0;
  for (const point of points.values()) {
    const cashPoint = cashByDate.get(point.date);
    point.dailyInflow = cashPoint?.inflow ?? 0;
    point.dailyOutflow = cashPoint?.outflow ?? 0;
    cumulativeInflow += point.dailyInflow;
    cumulativeOutflow += point.dailyOutflow;
    point.cumulativeInflow = cumulativeInflow;
    point.cumulativeOutflow = cumulativeOutflow;
  }
  if (!includeSeries) {
    cumulativeInflow = cashFlow.totalInflows;
    cumulativeOutflow = cashFlow.totalOutflows;
  }

  return {
    totalInflow: cumulativeInflow,
    totalOutflow: cumulativeOutflow,
    inflowItems: inflowItems.sort((left, right) =>
      right.date.localeCompare(left.date),
    ),
    outflowItems: outflowItems.sort((left, right) =>
      right.date.localeCompare(left.date),
    ),
    pendingCount,
    ignoredCount,
    largestInflow: cashFlow.largestInflow,
    largestOutflow: cashFlow.largestOutflow,
    dailySeries: [...points.values()],
  };
}

export function isTransactionalBankAccount(account: FinancialAccount) {
  return (
    account.status === "active" &&
    TRANSACTIONAL_ACCOUNT_TYPES.has(account.account_type.toLowerCase())
  );
}

export function calculateBankAccountMonthlyMovement({
  account,
  transactions,
  previousTransactions = [],
  period,
  connection = null,
}: {
  account: FinancialAccount;
  transactions: FinancialTransaction[];
  previousTransactions?: FinancialTransaction[];
  period: FinanceMonthPeriod;
  connection?: BankConnectionSummary | null;
}): BankAccountMonthlyMovement {
  const current = calculatePeriodMovement({
    account,
    transactions,
    period,
    includeSeries: true,
  });
  const previous = calculatePeriodMovement({
    account,
    transactions: previousTransactions,
    period: shiftFinanceMonth(period, -1),
    includeSeries: false,
  });

  const dataCompleteness =
    account.source === "manual"
      ? "complete"
      : connection?.data_completeness === "partial" ||
          connection?.provider_status === "degraded" ||
          connection?.provider_status === "unavailable"
        ? "partial"
        : connection?.data_completeness === "stale" ||
            Boolean(connection?.stale_since)
          ? "stale"
          : "complete";
  const warnings: string[] = [];
  if (dataCompleteness === "partial") {
    warnings.push("Dados parciais: a sincronização bancária está incompleta.");
  } else if (dataCompleteness === "stale") {
    warnings.push("Dados desatualizados: confira a última sincronização.");
  }
  if (current.pendingCount) {
    warnings.push(
      `${current.pendingCount} ${current.pendingCount === 1 ? "lançamento pendente foi excluído" : "lançamentos pendentes foram excluídos"} do resultado definitivo.`,
    );
  }

  return {
    accountId: account.id,
    accountName: account.name,
    institutionName: account.institution_name,
    accountType: account.account_type,
    source: account.source,
    currentBalance: Number(account.current_balance ?? 0),
    monthStart: period.startDate,
    monthEnd: period.endExclusiveDate,
    totalInflow: current.totalInflow,
    totalOutflow: current.totalOutflow,
    netMovement: current.totalInflow - current.totalOutflow,
    inflowCount: current.inflowItems.length,
    outflowCount: current.outflowItems.length,
    largestInflow: current.largestInflow,
    largestOutflow: current.largestOutflow,
    inflowItems: current.inflowItems,
    outflowItems: current.outflowItems,
    previousMonthInflow: previous.totalInflow,
    previousMonthOutflow: previous.totalOutflow,
    pendingCount: current.pendingCount,
    ignoredCount: current.ignoredCount,
    dailySeries: current.dailySeries,
    lastSyncAt:
      account.last_sync_at ??
      connection?.last_successful_sync_at ??
      connection?.last_sync_at ??
      null,
    dataCompleteness,
    warnings,
  };
}

export function getBankAccountMonthlyMovement(
  input: Parameters<typeof calculateBankAccountMonthlyMovement>[0],
) {
  return calculateBankAccountMonthlyMovement(input);
}
