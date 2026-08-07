import type { IncomeExpenseListItem } from "./income-expenses-query";

export type ExpenseOrigin =
  | "bank_account"
  | "credit_card"
  | "payroll"
  | "unknown";

export type ExpenseFilter = "all" | "open" | "paid" | "overdue" | "automatic";

export type ExpensePresentationStatus =
  | "overdue"
  | "open"
  | "partial"
  | "paid"
  | "paid_difference"
  | "card_planned"
  | "card_posted"
  | "payroll_planned"
  | "payroll_paid";

export type ExpenseOriginSummary = {
  totalCents: number;
  paidCents: number;
  openCents: number;
  count: number;
};

export type ExpenseOriginGroup = {
  origin: ExpenseOrigin;
  items: IncomeExpenseListItem[];
  summary: ExpenseOriginSummary;
};

const bankMethods = new Set([
  "bank_debit", "automatic_debit", "pix", "boleto", "transfer",
]);
const cardMethods = new Set(["credit_card", "card"]);

export function classifyExpenseOrigin(item: IncomeExpenseListItem): ExpenseOrigin {
  if (item.isPayrollDeduction || item.paymentChannel === "payroll" ||
    item.paymentMethod === "payroll") return "payroll";
  if (item.paymentChannel === "card" || item.cardId ||
    cardMethods.has(item.paymentMethod ?? "")) return "credit_card";
  if (item.paymentChannel === "bank" || item.accountId ||
    bankMethods.has(item.paymentMethod ?? "")) return "bank_account";
  return "unknown";
}

export function openExpenseAmountCents(item: IncomeExpenseListItem) {
  if (classifyExpenseOrigin(item) === "payroll") return 0;
  if (item.amountType === "variable" && item.realizedAmountCents > 0) return 0;
  return Math.max(item.expectedAmountCents - item.realizedAmountCents, 0);
}

export function expensePresentationStatus(
  item: IncomeExpenseListItem,
  today: string,
): ExpensePresentationStatus {
  const origin = classifyExpenseOrigin(item);
  if (origin === "payroll") {
    return "payroll_paid";
  }
  if (item.amountType === "variable" && item.realizedAmountCents > 0) {
    return "paid";
  }
  if (origin === "credit_card") {
    return item.realizedAmountCents > 0 || item.linkedTransactionId
      ? "card_posted"
      : "card_planned";
  }
  const openCents = openExpenseAmountCents(item);
  if (item.realizedAmountCents > item.expectedAmountCents &&
    item.expectedAmountCents > 0) return "paid_difference";
  if (item.realizedAmountCents > 0 && openCents > 0) return "partial";
  if (item.realizedAmountCents > 0 && openCents === 0) return "paid";
  if (item.expectedDate && item.expectedDate < today) return "overdue";
  return "open";
}

export function isAutomaticExpense(item: IncomeExpenseListItem) {
  return classifyExpenseOrigin(item) === "payroll" ||
    ["bank_debit", "automatic_debit"].includes(item.paymentMethod ?? "");
}

export function matchesExpenseFilter(
  item: IncomeExpenseListItem,
  filter: ExpenseFilter,
  today: string,
) {
  const status = expensePresentationStatus(item, today);
  if (filter === "all") return true;
  if (filter === "automatic") return isAutomaticExpense(item);
  if (filter === "overdue") return status === "overdue";
  if (filter === "paid") {
    return ["paid", "paid_difference", "payroll_paid"].includes(status);
  }
  return ["open", "partial", "card_planned", "card_posted", "payroll_planned"].includes(status);
}

const bankOrder: Record<ExpensePresentationStatus, number> = {
  overdue: 0,
  open: 1,
  partial: 2,
  paid: 3,
  paid_difference: 3,
  card_planned: 0,
  card_posted: 0,
  payroll_planned: 0,
  payroll_paid: 0,
};

function sortGroup(origin: ExpenseOrigin, today: string) {
  return (left: IncomeExpenseListItem, right: IncomeExpenseListItem) => {
    if (origin === "bank_account" || origin === "unknown") {
      const priority = bankOrder[expensePresentationStatus(left, today)] -
        bankOrder[expensePresentationStatus(right, today)];
      if (priority) return priority;
      return (left.expectedDate ?? "9999-12-31").localeCompare(
        right.expectedDate ?? "9999-12-31",
      );
    }
    const leftPosted = expensePresentationStatus(left, today) === "card_posted" ? 0 : 1;
    const rightPosted = expensePresentationStatus(right, today) === "card_posted" ? 0 : 1;
    return leftPosted - rightPosted || left.title.localeCompare(right.title);
  };
}

function summarize(items: IncomeExpenseListItem[]): ExpenseOriginSummary {
  return items.reduce<ExpenseOriginSummary>((summary, item) => {
    const payroll = classifyExpenseOrigin(item) === "payroll";
    const settledVariable = item.amountType === "variable" &&
      item.realizedAmountCents > 0;
    const paidCents = payroll
      ? item.expectedAmountCents
      : item.realizedAmountCents;
    return {
      totalCents: summary.totalCents + (settledVariable
        ? item.realizedAmountCents
        : item.expectedAmountCents),
      paidCents: summary.paidCents + paidCents,
      openCents: summary.openCents + openExpenseAmountCents(item),
      count: summary.count + 1,
    };
  }, { totalCents: 0, paidCents: 0, openCents: 0, count: 0 });
}

export function buildExpenseOriginGroups(
  items: IncomeExpenseListItem[],
  today: string,
  filter: ExpenseFilter = "all",
) {
  const all = items.filter(item => item.direction === "expense");
  const grouped = new Map<ExpenseOrigin, IncomeExpenseListItem[]>([
    ["bank_account", []],
    ["credit_card", []],
    ["payroll", []],
    ["unknown", []],
  ]);
  for (const item of all) grouped.get(classifyExpenseOrigin(item))?.push(item);
  const groups = (["bank_account", "credit_card", "payroll", "unknown"] as const)
    .map(origin => ({
      origin,
      items: (grouped.get(origin) ?? [])
        .filter(item => matchesExpenseFilter(item, filter, today))
        .sort(sortGroup(origin, today)),
      summary: summarize(grouped.get(origin) ?? []),
    }));
  return { summary: summarize(all), groups };
}
