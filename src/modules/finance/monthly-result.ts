import type { CardPurchase, FinancialTransaction } from "./types";
import { persistedCardMovementAmountBrl } from "./foreign-card-movement";

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}/;
const MONTH_KEY = /^\d{4}-(0[1-9]|1[0-2])$/;
const REALIZED_STATUSES = new Set(["realized", "completed", "paid", "received"]);
const EXPECTED_STATUSES = new Set(["forecast", "pending", "partial", "overdue"]);
const EXCLUDED_CASH_FLOW_KINDS = new Set([
  "balance_adjustment",
  "investment_contribution",
  "investment_redemption",
  "investment_transfer",
  "loan_proceeds",
  "principal_redemption",
]);

export type FinanceMonthPeriod = {
  year: number;
  month: number;
  key: string;
  timeZone: string;
  startDate: string;
  endExclusiveDate: string;
  startInstant: string;
  endExclusiveInstant: string;
};

export type FinanceCalculationScope = {
  workspaceId?: string | null;
};

export type MonthlyResultEntry = {
  id: string;
  amount: number;
  kind: "revenue" | "expense" | "expense_refund";
  source: "transaction" | "card_purchase";
  category: string;
  date: string;
  dueDate: string | null;
  description: string;
  context: string;
  institution: string | null;
  sourceKind: "account" | "card" | "payroll" | "cash";
  origin: string;
  status: string;
  reviewStatus: string;
  competenceDate: string | null;
  transactionRole: string;
  installment: string | null;
  recurring: boolean;
  bankDirection?: string | null;
  financialNature?: string | null;
  financialRole?: string | null;
  providerPostedAt?: string | null;
  effectiveAt?: string | null;
  classificationSource?: string | null;
  classificationConfidence?: string | null;
};

export type MonthlyFinancialResult = {
  period: FinanceMonthPeriod;
  realizedRevenue: number;
  realizedExpenses: number;
  monthlyResult: number;
  expectedRevenue: number;
  expectedExpenses: number;
  payrollDeductions: number;
  analyticalExpenses: number;
  entries: MonthlyResultEntry[];
  expectedEntries: MonthlyResultEntry[];
};

type DateCandidate = {
  competence_date?: string | null;
  realized_at?: string | null;
  purchase_date?: string | null;
  transaction_date?: string | null;
  due_date?: string | null;
  created_at?: string | null;
  status?: string | null;
};

type ScopedRow = {
  workspace_id?: string | null;
  visibility?: string | null;
};

function pad(value: number) {
  return String(value).padStart(2, "0");
}

function zonedParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  return Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  ) as Record<"year" | "month" | "day" | "hour" | "minute" | "second", number>;
}

function zonedMidnightInstant(
  year: number,
  month: number,
  day: number,
  timeZone: string,
) {
  const target = Date.UTC(year, month - 1, day);
  let guess = target;
  for (let iteration = 0; iteration < 3; iteration++) {
    const actual = zonedParts(new Date(guess), timeZone);
    const represented = Date.UTC(
      actual.year,
      actual.month - 1,
      actual.day,
      actual.hour,
      actual.minute,
      actual.second,
    );
    guess += target - represented;
  }
  return new Date(guess).toISOString();
}

export function getFinanceMonthPeriod({
  year,
  month,
  timeZone = "America/Sao_Paulo",
}: {
  year: number;
  month: number;
  timeZone?: string;
}): FinanceMonthPeriod {
  if (!Number.isInteger(year) || year < 1900 || year > 2200) {
    throw new RangeError("Ano financeiro inválido.");
  }
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new RangeError("Mês financeiro inválido.");
  }
  new Intl.DateTimeFormat("pt-BR", { timeZone }).format(0);

  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  return {
    year,
    month,
    key: `${year}-${pad(month)}`,
    timeZone,
    startDate: `${year}-${pad(month)}-01`,
    endExclusiveDate: `${nextYear}-${pad(nextMonth)}-01`,
    startInstant: zonedMidnightInstant(year, month, 1, timeZone),
    endExclusiveInstant: zonedMidnightInstant(
      nextYear,
      nextMonth,
      1,
      timeZone,
    ),
  };
}

export function resolveFinanceMonthPeriod({
  selectedMonth,
  timeZone = "America/Sao_Paulo",
  referenceDate = new Date(),
}: {
  selectedMonth?: string | null;
  timeZone?: string;
  referenceDate?: Date;
}) {
  if (selectedMonth && MONTH_KEY.test(selectedMonth)) {
    const [year, month] = selectedMonth.split("-").map(Number);
    return getFinanceMonthPeriod({ year, month, timeZone });
  }
  const current = zonedParts(referenceDate, timeZone);
  return getFinanceMonthPeriod({
    year: current.year,
    month: current.month,
    timeZone,
  });
}

export function shiftFinanceMonth(period: FinanceMonthPeriod, offset: number) {
  const shifted = new Date(Date.UTC(period.year, period.month - 1 + offset, 1));
  return getFinanceMonthPeriod({
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    timeZone: period.timeZone,
  });
}

function normalizedDate(value: string | null | undefined, timeZone: string) {
  if (!value) return null;
  if (DATE_ONLY.test(value)) return value.slice(0, 10);
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) return null;
  const parts = zonedParts(parsed, timeZone);
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
}

/**
 * Financial competence priority:
 * competence_date, realized_at, purchase/transaction date, due date for
 * expected obligations, then created_at only as a legacy fallback.
 */
export function financialCompetenceDate(
  row: DateCandidate,
  timeZone = "America/Sao_Paulo",
) {
  const competence = normalizedDate(row.competence_date, timeZone);
  if (competence) return competence;
  const realized = normalizedDate(row.realized_at, timeZone);
  if (realized) return realized;
  const eventDate = normalizedDate(
    row.purchase_date ?? row.transaction_date,
    timeZone,
  );
  if (eventDate) return eventDate;
  if (row.status && EXPECTED_STATUSES.has(row.status)) {
    const due = normalizedDate(row.due_date, timeZone);
    if (due) return due;
  }
  return normalizedDate(row.created_at, timeZone);
}

export function isInFinanceScope(
  row: ScopedRow,
  scope: FinanceCalculationScope = {},
) {
  if (scope.workspaceId) {
    return (
      row.workspace_id === scope.workspaceId && row.visibility === "workspace"
    );
  }
  return !row.workspace_id && row.visibility !== "workspace";
}

function isInPeriod(date: string | null, period: FinanceMonthPeriod) {
  return Boolean(
    date && date >= period.startDate && date < period.endExclusiveDate,
  );
}

function isReviewed(row: { review_status?: string | null }) {
  return !row.review_status || row.review_status === "reviewed";
}

function hasTarget(transaction: FinancialTransaction) {
  if (transaction.source_type === "payroll") {
    return Boolean(
      transaction.loan_id ||
        transaction.recurring_rule_id ||
        transaction.external_id,
    );
  }
  if (transaction.transaction_role === "transfer") {
    return Boolean(
      transaction.account_id &&
        transaction.destination_account_id &&
        transaction.account_id !== transaction.destination_account_id,
    );
  }
  if (transaction.transaction_role === "invoice_payment") {
    return Boolean(
      transaction.account_id &&
        (transaction.credit_card_id || transaction.invoice_id),
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

function transactionKind(
  transaction: FinancialTransaction,
): MonthlyResultEntry["kind"] | null {
  if (transaction.financial_role === "revenue") return "revenue";
  if (
    transaction.financial_role === "expense" ||
    transaction.financial_role === "debt_payment"
  ) {
    return "expense";
  }
  if (transaction.financial_role === "correction") return "expense_refund";
  if (
    transaction.financial_role &&
    [
      "cash_flow_only",
      "transfer",
      "debt_proceeds",
      "investment_principal",
      "pending_review",
    ].includes(transaction.financial_role)
  ) {
    return null;
  }
  if (
    transaction.transaction_role === "transfer" ||
    transaction.transaction_role === "invoice_payment" ||
    transaction.transaction_role === "adjustment" ||
    EXCLUDED_CASH_FLOW_KINDS.has(transaction.cash_flow_kind ?? "")
  ) {
    return null;
  }
  if (
    transaction.transaction_role === "refund" ||
    transaction.transaction_type === "refund" ||
    transaction.transaction_type === "reversal"
  ) {
    return "expense_refund";
  }
  if (transaction.transaction_type === "income") return "revenue";
  if (transaction.transaction_type === "expense") return "expense";
  return null;
}

function purchaseKind(
  purchase: CardPurchase,
): MonthlyResultEntry["kind"] | null {
  if (
    purchase.transaction_role === "consumption" ||
    purchase.transaction_role === "foreign_transaction_tax"
  ) return "expense";
  if (purchase.transaction_role === "refund") return "expense_refund";
  return null;
}

function dedupe<T extends { id: string; external_id?: string | null; source: string }>(
  rows: T[],
) {
  const seen = new Set<string>();
  return rows.filter((row) => {
    const key = row.external_id
      ? `${row.source}:${row.external_id}`
      : `id:${row.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function entryAmount(kind: MonthlyResultEntry["kind"], value: number) {
  const normalized = Math.abs(Number(value || 0));
  return kind === "expense_refund" ? -normalized : normalized;
}

export function calculateMonthlyFinancialResult({
  transactions,
  purchases,
  period,
  scope = {},
}: {
  transactions: FinancialTransaction[];
  purchases: CardPurchase[];
  period: FinanceMonthPeriod;
  scope?: FinanceCalculationScope;
}): MonthlyFinancialResult {
  const entries: MonthlyResultEntry[] = [];
  const expectedEntries: MonthlyResultEntry[] = [];

  for (const transaction of dedupe(transactions)) {
    if (
      !isInFinanceScope(transaction, scope) ||
      !isReviewed(transaction) ||
      !hasTarget(transaction) ||
      !isInPeriod(
        financialCompetenceDate(transaction, period.timeZone),
        period,
      )
    ) {
      continue;
    }
    const kind = transactionKind(transaction);
    if (!kind) continue;
    const entry = {
      id: transaction.id,
      amount: entryAmount(kind, transaction.amount),
      kind,
      source: "transaction",
      category: transaction.financial_categories?.name || "Sem categoria",
      date: financialCompetenceDate(transaction, period.timeZone)!,
      dueDate: transaction.due_date,
      description: transaction.description,
      context:
        transaction.financial_accounts?.name ||
        transaction.credit_cards?.name ||
        (transaction.source_type === "payroll"
          ? "Folha de pagamento"
          : transaction.source === "manual"
            ? "Cadastro manual"
            : "Conta bancária"),
      institution:
        transaction.financial_accounts?.institution_name ?? null,
      sourceKind:
        transaction.source_type === "card"
          ? "card"
          : transaction.source_type === "payroll"
            ? "payroll"
            : transaction.account_id
              ? "account"
              : "cash",
      origin: transaction.source === "pluggy" ? "Pluggy" : "Manual",
      status: transaction.status,
      reviewStatus: transaction.review_status || "reviewed",
      competenceDate: transaction.competence_date,
      transactionRole: transaction.transaction_role,
      installment: null,
      recurring: Boolean(transaction.recurring_rule_id),
      bankDirection: transaction.bank_direction,
      financialNature: transaction.financial_nature,
      financialRole: transaction.financial_role,
      providerPostedAt: transaction.provider_posted_at,
      effectiveAt: transaction.user_effective_at ?? transaction.effective_at,
      classificationSource: transaction.classification_source,
      classificationConfidence: transaction.classification_confidence,
    } satisfies MonthlyResultEntry;
    if (REALIZED_STATUSES.has(transaction.status)) entries.push(entry);
    else if (EXPECTED_STATUSES.has(transaction.status)) expectedEntries.push(entry);
  }

  for (const purchase of dedupe(purchases)) {
    if (
      !isInFinanceScope(purchase, scope) ||
      !isReviewed(purchase) ||
      !isInPeriod(financialCompetenceDate(purchase, period.timeZone), period)
    ) {
      continue;
    }
    const kind = purchaseKind(purchase);
    if (!kind) continue;
    const entry = {
      id: purchase.id,
      amount: entryAmount(
        kind,
        persistedCardMovementAmountBrl(purchase) ?? 0,
      ),
      kind,
      source: "card_purchase",
      category: purchase.financial_categories?.name || "Sem categoria",
      date: financialCompetenceDate(purchase, period.timeZone)!,
      dueDate: purchase.due_date ?? null,
      description: purchase.description,
      context: purchase.credit_cards?.name || "Cartão de crédito",
      institution: purchase.credit_cards?.institution_name ?? null,
      sourceKind: "card",
      origin: purchase.source === "pluggy" ? "Pluggy" : "Manual",
      status: purchase.status,
      reviewStatus: purchase.review_status || "reviewed",
      competenceDate: purchase.competence_date ?? null,
      transactionRole: purchase.transaction_role,
      installment:
        purchase.installment_number && purchase.installment_count
          ? `${purchase.installment_number}/${purchase.installment_count}`
          : null,
      recurring: Boolean(purchase.installment_plan_id),
      bankDirection: null,
      financialNature: null,
      financialRole: null,
      providerPostedAt: null,
      effectiveAt: null,
      classificationSource: null,
      classificationConfidence: null,
    } satisfies MonthlyResultEntry;
    if (REALIZED_STATUSES.has(purchase.status)) entries.push(entry);
    else if (EXPECTED_STATUSES.has(purchase.status)) expectedEntries.push(entry);
  }

  const realizedRevenue = entries
    .filter((entry) => entry.kind === "revenue")
    .reduce((total, entry) => total + entry.amount, 0);
  const realizedExpenses = entries
    .filter((entry) =>
      entry.kind !== "revenue" && entry.sourceKind !== "payroll"
    )
    .reduce((total, entry) => total + entry.amount, 0);
  const payrollDeductions = entries
    .filter(entry =>
      entry.kind !== "revenue" && entry.sourceKind === "payroll"
    )
    .reduce((total, entry) => total + entry.amount, 0);
  const expectedRevenue = expectedEntries
    .filter((entry) => entry.kind === "revenue")
    .reduce((total, entry) => total + entry.amount, 0);
  const expectedExpenses = expectedEntries
    .filter((entry) =>
      entry.kind !== "revenue" && entry.sourceKind !== "payroll"
    )
    .reduce((total, entry) => total + entry.amount, 0);

  return {
    period,
    realizedRevenue,
    realizedExpenses,
    monthlyResult: realizedRevenue - realizedExpenses,
    expectedRevenue,
    expectedExpenses,
    payrollDeductions,
    analyticalExpenses: realizedExpenses + payrollDeductions,
    entries,
    expectedEntries,
  };
}
