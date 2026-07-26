import {
  countsAsIncomeOrExpense,
  hasDefinitiveTarget,
  isExpense,
  isIncome,
  summarizeFinance,
} from "./calculations";
import {
  calculateMonthlyFinancialResult,
  financialCompetenceDate,
  isInFinanceScope,
  resolveFinanceMonthPeriod,
  shiftFinanceMonth,
  type FinanceCalculationScope,
  type FinanceMonthPeriod,
} from "./monthly-result";
import type {
  BankConnectionSummary,
  CardPurchase,
  FinanceSummary,
  FinancialAccount,
  FinancialTransaction,
} from "./types";
import type { CurrentCardInvoice } from "./card-invoices";

const amount = (value: number | string | null | undefined) =>
  Math.abs(Number(value ?? 0));

const dateKey = (date: Date) => date.toISOString().slice(0, 10);
export type Trend = {
  previous: number | null;
  percentage: number | null;
  difference: number | null;
};

export type BalancePoint = { label: string; value: number };
export type CashFlowPoint = {
  label: string;
  income: number;
  expenses: number;
  balance: number;
};

export type ExpenseCategory = {
  name: string;
  value: number;
  percentage: number;
};

export type FinancialCommitment = {
  id: string;
  date: string;
  description: string;
  category: string;
  value: number;
  status: string;
  href: string;
};

export type FinancialAttention = {
  id: string;
  label: string;
  priority: "Alta" | "Média" | "Baixa";
  href: string;
};

export type FinanceDashboard = {
  summary: FinanceSummary;
  previousSummary: FinanceSummary;
  selectedPeriod: FinanceMonthPeriod;
  resultTrend: Trend;
  balancePoints: BalancePoint[];
  cashFlow: CashFlowPoint[];
  expenseCategories: ExpenseCategory[];
  commitments: FinancialCommitment[];
  attention: FinancialAttention[];
  activeAccountCount: number;
  degradedConnection: BankConnectionSummary | null;
  dataCompleteness: "complete" | "partial" | "stale";
};

function resultPercentage(current: number, previous: number): number | null {
  return previous
    ? ((current - previous) / Math.abs(previous)) * 100
    : null;
}

function categoryName(
  row: FinancialTransaction | CardPurchase,
): string {
  return row.financial_categories?.name || "Sem categoria";
}

export function buildFinanceDashboard(
  accounts: FinancialAccount[],
  transactions: FinancialTransaction[],
  purchases: CardPurchase[],
  invoices: CurrentCardInvoice[],
  connections: BankConnectionSummary[],
  today = new Date(),
  options: {
    selectedMonth?: string | null;
    timeZone?: string;
    scope?: FinanceCalculationScope;
  } = {},
): FinanceDashboard {
  const selectedPeriod = resolveFinanceMonthPeriod({
    selectedMonth: options.selectedMonth,
    timeZone: options.timeZone,
    referenceDate: today,
  });
  const previousPeriod = shiftFinanceMonth(selectedPeriod, -1);
  const scope = options.scope ?? {};
  const degradedConnection =
    connections.find(
      (connection) =>
        connection.provider_status === "degraded" ||
        connection.provider_status === "unavailable" ||
        connection.data_completeness === "partial",
    ) ?? null;
  const staleConnection =
    connections.find(
      (connection) =>
        connection.data_completeness === "stale" ||
        Boolean(connection.stale_since),
    ) ?? null;
  const dataCompleteness = degradedConnection
    ? "partial"
    : staleConnection
      ? "stale"
      : "complete";
  const monthly = calculateMonthlyFinancialResult({
    transactions,
    purchases,
    period: selectedPeriod,
    scope,
  });
  const previousMonthly = calculateMonthlyFinancialResult({
    transactions,
    purchases,
    period: previousPeriod,
    scope,
  });
  const summary = summarizeFinance(accounts, transactions, purchases, today, {
    period: selectedPeriod,
    scope,
  });
  const previousSummary = summarizeFinance(
    accounts,
    transactions,
    purchases,
    today,
    { period: previousPeriod, scope },
  );
  const currentExpenses = monthly.entries.filter(
    (entry) => entry.kind !== "revenue",
  );
  const activeAccounts = accounts.filter(
    (account) =>
      isInFinanceScope(account, scope) &&
      account.status === "active" &&
      account.account_type !== "investment",
  );
  const end = new Date(
    Date.UTC(selectedPeriod.year, selectedPeriod.month, 0, 12),
  );
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 29);
  const realized = transactions.filter(
    (transaction) =>
      transaction.status === "realized" &&
      isInFinanceScope(transaction, scope) &&
      hasDefinitiveTarget(transaction) &&
      transaction.competence_date >= dateKey(start) &&
      transaction.competence_date <= dateKey(end),
  );
  const running = summary.available;
  const values = new Map<string, number>();
  for (let offset = 29; offset >= 0; offset--) {
    const day = new Date(end);
    day.setUTCDate(day.getUTCDate() - offset);
    values.set(dateKey(day), running);
  }
  for (const transaction of [...realized].sort((a, b) =>
    b.competence_date.localeCompare(a.competence_date),
  )) {
    if (transaction.transaction_role === "transfer") continue;
    const delta = isIncome(transaction)
      ? amount(transaction.amount)
      : isExpense(transaction) || transaction.transaction_role === "invoice_payment"
        ? -amount(transaction.amount)
        : 0;
    for (const key of values.keys()) {
      if (key < transaction.competence_date) {
        values.set(key, (values.get(key) ?? running) - delta);
      }
    }
  }
  const balancePoints = [...values.entries()]
    .filter((_, index) => index % 3 === 0 || index === values.size - 1)
    .map(([date, value]) => ({
      label: new Intl.DateTimeFormat("pt-BR", {
        day: "2-digit",
        month: "short",
        timeZone: "UTC",
      }).format(new Date(`${date}T12:00:00Z`)),
      value,
    }));

  let accumulated = 0;
  const cashFlow = Array.from({ length: 6 }, (_, index) => {
    const period = shiftFinanceMonth(selectedPeriod, index - 5);
    const result = calculateMonthlyFinancialResult({
      transactions,
      purchases,
      period,
      scope,
    });
    const income = result.realizedRevenue;
    const expenses = result.realizedExpenses;
    accumulated += income - expenses;
    return {
      label: new Intl.DateTimeFormat("pt-BR", {
        month: "short",
        timeZone: "UTC",
      }).format(new Date(`${period.startDate}T12:00:00Z`)),
      income,
      expenses,
      balance: accumulated,
    };
  });

  const categoryTotals = new Map<string, number>();
  for (const entry of currentExpenses) {
    categoryTotals.set(
      entry.category,
      (categoryTotals.get(entry.category) ?? 0) + entry.amount,
    );
  }
  const expenseTotal = [...categoryTotals.values()].reduce(
    (total, value) => total + value,
    0,
  );
  const sortedCategories = [...categoryTotals.entries()].sort(
    (left, right) => right[1] - left[1],
  );
  const visible = sortedCategories.slice(0, 6);
  const remainder = sortedCategories
    .slice(6)
    .reduce((total, row) => total + row[1], 0);
  if (remainder) visible.push(["Outros", remainder]);
  const expenseCategories = visible.map(([name, value]) => ({
    name,
    value,
    percentage: expenseTotal ? (value / expenseTotal) * 100 : 0,
  }));

  const currentPeriod = resolveFinanceMonthPeriod({
    referenceDate: today,
    timeZone: selectedPeriod.timeZone,
  });
  const todayKey =
    financialCompetenceDate(
      { realized_at: today.toISOString() },
      selectedPeriod.timeZone,
    ) ?? dateKey(today);
  const commitmentStart =
    currentPeriod.key === selectedPeriod.key
      ? todayKey
      : selectedPeriod.startDate;
  const commitments: FinancialCommitment[] = transactions
    .filter(
      (transaction) =>
        transaction.due_date &&
        isInFinanceScope(transaction, scope) &&
        transaction.due_date >= commitmentStart &&
        transaction.due_date < selectedPeriod.endExclusiveDate &&
        transaction.status !== "realized" &&
        transaction.status !== "cancelled" &&
        isExpense(transaction) &&
        countsAsIncomeOrExpense(transaction),
    )
    .map((transaction) => ({
      id: transaction.id,
      date: transaction.due_date!,
      description: transaction.description,
      category: categoryName(transaction),
      value: amount(transaction.amount),
      status: transaction.status,
      href: "/financeiro/movimentacoes",
    }));
  for (const invoice of invoices) {
    if (
      !invoice.cycle ||
      invoice.cycle.dueDate < commitmentStart ||
      invoice.cycle.dueDate >= selectedPeriod.endExclusiveDate
    ) {
      continue;
    }
    commitments.push({
      id: `invoice-${invoice.card.id}`,
      date: invoice.cycle.dueDate,
      description: `Fatura ${invoice.card.name}`,
      category: "Cartão de crédito",
      value: invoice.invoiceTotal,
      status: invoice.totalSource === "provider_bill" ? "Oficial" : "Estimativa",
      href: `/financeiro/cartoes/${invoice.card.id}`,
    });
  }
  commitments.sort((left, right) => left.date.localeCompare(right.date));

  const attention: FinancialAttention[] = [];
  if (summary.overdue > 0) {
    attention.push({
      id: "overdue",
      label: "Existem compromissos financeiros vencidos",
      priority: "Alta",
      href: "/financeiro/movimentacoes?status=overdue",
    });
  }
  const divergent = invoices.filter(
    (invoice) => invoice.reconciliationStatus === "divergent",
  ).length;
  if (divergent) {
    attention.push({
      id: "invoice-reconciliation",
      label: `${divergent} ${divergent === 1 ? "fatura precisa" : "faturas precisam"} de conciliação`,
      priority: "Alta",
      href: "/financeiro/cartoes",
    });
  }
  const uncategorized =
    currentExpenses.filter((entry) => entry.category === "Sem categoria").length;
  if (uncategorized) {
    attention.push({
      id: "uncategorized",
      label: `${uncategorized} ${uncategorized === 1 ? "compra está" : "compras estão"} sem categoria`,
      priority: "Média",
      href: "/financeiro/movimentacoes?review=pending",
    });
  }
  const suspectedTransfers = transactions.filter(
    (row) => row.suspected_transfer && row.review_status === "pending",
  ).length;
  if (suspectedTransfers) {
    attention.push({
      id: "transfers",
      label: `${suspectedTransfers} possíveis transferências entre contas próprias`,
      priority: "Baixa",
      href: "/financeiro/movimentacoes?review=pending",
    });
  }
  const inconsistentClassifications = transactions.filter((row) => {
    const providerType = row.provider_type?.toUpperCase();
    return (
      row.classification_confidence === "low" ||
      row.bank_direction === "review" ||
      (providerType === "DEBIT" && row.financial_role === "revenue") ||
      (providerType === "CREDIT" && row.financial_role === "expense") ||
      (row.financial_nature === "investment_income" &&
        row.financial_role !== "revenue") ||
      (row.financial_nature === "financing_payment" &&
        row.bank_direction !== "outflow") ||
      (row.financial_nature === "pix_received" && !row.financial_role)
    );
  }).length;
  if (inconsistentClassifications) {
    attention.push({
      id: "bank-classification",
      label: `${inconsistentClassifications} ${inconsistentClassifications === 1 ? "movimentação bancária precisa" : "movimentações bancárias precisam"} de revisão`,
      priority: "Alta",
      href: "/financeiro/movimentacoes?tab=bank&review=pending",
    });
  }
  if (degradedConnection) {
    attention.push({
      id: "provider",
      label: `${degradedConnection.connector_name || "Conector bancário"} está com sincronização degradada`,
      priority: "Média",
      href: "/financeiro/integracoes",
    });
  }

  return {
    summary,
    previousSummary,
    selectedPeriod,
    resultTrend: {
      previous: previousSummary.monthlyResult,
      percentage: resultPercentage(
        summary.monthlyResult,
        previousSummary.monthlyResult,
      ),
      difference:
        summary.monthlyResult - previousMonthly.monthlyResult,
    },
    balancePoints,
    cashFlow,
    expenseCategories,
    commitments: commitments.slice(0, 5),
    attention: attention.slice(0, 5),
    activeAccountCount: activeAccounts.length,
    degradedConnection,
    dataCompleteness,
  };
}
