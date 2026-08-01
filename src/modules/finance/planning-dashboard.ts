import type {
  FinanceOverviewInvoice,
} from "./finance-overview-dashboard";
import type {
  IncomeExpenseListItem,
  IncomeExpensePageData,
} from "./income-expenses-query";
import type { MonthlyCommitmentProjection } from "./commitments";

export type PlanningConfidence = "high" | "medium" | "low";
export type PlanningPriority = "essential" | "adjustable" | "optional" | "unclassified";

export type CanonicalPlanningItem = {
  canonicalId: string;
  kind: "income" | "expense" | "invoice" | "payroll" | "installment" | "loan";
  source: string;
  title: string;
  expectedAmount: number;
  realizedAmount: number;
  planningAmount: number;
  cashEffect: boolean;
  includedInInvoice: boolean;
  includedInOtherTotal: boolean;
  deduplicationReason: string | null;
  expectedDate: string | null;
  method: string;
  paymentMethod: string | null;
  context: string;
  priority: PlanningPriority;
  confidence: PlanningConfidence;
  dataQuality?: string;
};

export type PlanningNextMonthSummary = {
  month: string;
  expectedIncome: number;
  expectedExpenses: number;
  estimatedFreeAmount: number;
  committedPercentage: number | null;
  expectedIncomeSourcesCount: number;
  expectedExpensesCount: number;
  cardInvoicesAmount: number;
  recurringExpensesAmount: number;
  oneTimeExpensesAmount: number;
  dependentsAmount: number;
  householdAmount: number;
  confidence: PlanningConfidence;
  warnings: string[];
};

export type PlanningProjectionPoint = PlanningNextMonthSummary;

export type PlanningAttentionItem = {
  id: string;
  severity: "info" | "warning" | "critical";
  title: string;
  description: string;
  actionLabel: string;
  href: string;
};

export type PlanningDashboard = {
  filters: {
    workspaceId: string;
    startMonth: string;
    horizon: 3 | 6 | 12;
    accountId: string | null;
    accounts: Array<{ id: string; name: string }>;
  };
  nextMonthSummary: PlanningNextMonthSummary;
  projectionSeries: PlanningProjectionPoint[];
  monthlySummaries: Array<{
    summary: PlanningNextMonthSummary;
    items: CanonicalPlanningItem[];
  }>;
  nextMonthIncome: CanonicalPlanningItem[];
  nextMonthExpenses: CanonicalPlanningItem[];
  payrollDeductionsInformational: CanonicalPlanningItem[];
  incomeCommitmentBreakdown: Array<{
    priority: PlanningPriority;
    amount: number;
    percentage: number | null;
  }>;
  attentionItems: PlanningAttentionItem[];
  dataFreshness: PlanningConfidence;
  warnings: string[];
};

const terminal = new Set(["paid", "received", "cancelled", "skipped", "archived", "completed"]);
const money = (cents: number) => Math.round(cents) / 100;
const round = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

function context(item: IncomeExpenseListItem) {
  return item.personNames[0] ?? ({
    personal: "Pessoal",
    household: "Casa",
    work: "Trabalho",
    travel: "Viagem",
  } as const)[item.contextType];
}

function priority(item: IncomeExpenseListItem): PlanningPriority {
  return item.budgetPriority === "essential" || item.budgetPriority === "adjustable" || item.budgetPriority === "optional"
    ? item.budgetPriority
    : "unclassified";
}

function confidence(item: IncomeExpenseListItem): PlanningConfidence {
  if (item.estimationMethod !== "historical_median") return "high";
  return item.historicalMonthsCount >= 9 ? "high" : item.historicalMonthsCount >= 3 ? "medium" : "low";
}

function remaining(item: IncomeExpenseListItem) {
  if (terminal.has(item.occurrenceStatus)) return 0;
  return money(Math.max(item.expectedAmountCents - item.realizedAmountCents, 0));
}

export function resolveCanonicalPlanningItems(input: {
  flow: IncomeExpensePageData;
  invoices?: FinanceOverviewInvoice[];
  monthlyCommitments?: MonthlyCommitmentProjection;
  accountId?: string | null;
}) {
  const invoices = input.invoices ?? [];
  const hasInvoiceTotal = invoices.some(invoice => (invoice.ownerPayableAmount ?? invoice.amount ?? 0) > 0);
  const accountMatches = (item: IncomeExpenseListItem) => !input.accountId || item.accountId === input.accountId;
  const items: CanonicalPlanningItem[] = [];

  for (const item of input.flow.incomes.filter(accountMatches)) {
    const planningAmount = remaining(item);
    if (!planningAmount) continue;
    items.push({
      canonicalId: `income:${item.occurrenceId ?? item.id}:${input.flow.month}`,
      kind: "income", source: item.estimationMethod, title: item.title,
      expectedAmount: money(item.expectedAmountCents), realizedAmount: money(item.realizedAmountCents),
      planningAmount, cashEffect: item.cashFlowEffect !== "none", includedInInvoice: false,
      includedInOtherTotal: false, deduplicationReason: null, expectedDate: item.expectedDate,
      method: item.estimationMethod, paymentMethod: item.paymentMethod, context: context(item),
      priority: "unclassified", confidence: confidence(item),
    });
  }

  for (const item of input.flow.expenses.filter(accountMatches)) {
    const amount = remaining(item);
    if (!amount) continue;
    const inInvoice = hasInvoiceTotal && item.paymentChannel === "card";
    items.push({
      canonicalId: `expense:${item.occurrenceId ?? item.id}:${input.flow.month}`,
      kind: "expense", source: item.paymentChannel, title: item.title,
      expectedAmount: money(item.expectedAmountCents), realizedAmount: money(item.realizedAmountCents),
      planningAmount: inInvoice ? 0 : amount, cashEffect: item.cashFlowEffect !== "none",
      includedInInvoice: inInvoice, includedInOtherTotal: inInvoice,
      deduplicationReason: inInvoice ? "Já incluído no total confiável da fatura." : null,
      expectedDate: item.expectedDate, method: item.estimationMethod,
      paymentMethod: item.paymentMethod, context: context(item), priority: priority(item),
      confidence: confidence(item),
    });
  }

  if (!input.accountId) {
    for (const invoice of invoices) {
      const amount = invoice.ownerPayableAmount ?? invoice.amount ?? 0;
      if (amount <= 0 || ["paid", "cancelled"].includes(invoice.status)) continue;
      items.push({
        canonicalId: `invoice:${invoice.id}:${input.flow.month}`, kind: "invoice",
        source: invoice.sourceLabel, title: `${invoice.name}${invoice.lastFour ? ` · ${invoice.lastFour}` : ""}`,
        expectedAmount: amount, realizedAmount: 0, planningAmount: amount, cashEffect: true,
        includedInInvoice: false, includedInOtherTotal: false, deduplicationReason: null,
        expectedDate: invoice.dueDate, method: invoice.sourceLabel, paymentMethod: "Cartão",
        context: "Pessoal", priority: "unclassified", confidence: invoice.confidence,
        dataQuality: invoice.partial ? "Dados parciais preservados" : "Total confiável",
      });
    }
  }

  for (const item of input.flow.payrollDeductions) {
    const amount = remaining(item);
    if (!amount) continue;
    items.push({
      canonicalId: `payroll:${item.occurrenceId ?? item.id}:${input.flow.month}`, kind: "payroll",
      source: "payroll", title: item.title, expectedAmount: amount, realizedAmount: 0,
      planningAmount: 0, cashEffect: false, includedInInvoice: false, includedInOtherTotal: true,
      deduplicationReason: "Já considerado antes do crédito da renda líquida.", expectedDate: item.expectedDate,
      method: item.estimationMethod, paymentMethod: "Folha", context: context(item),
      priority: priority(item), confidence: confidence(item),
    });
  }

  if (!input.accountId) {
    const month = input.monthlyCommitments;
    if (month?.installmentTotalCents && !hasInvoiceTotal) items.push({
      canonicalId: `installments:${input.flow.month}`, kind: "installment", source: "card_installment",
      title: "Parcelas futuras", expectedAmount: money(month.installmentTotalCents), realizedAmount: 0,
      planningAmount: money(month.installmentTotalCents), cashEffect: true, includedInInvoice: false,
      includedInOtherTotal: false, deduplicationReason: null, expectedDate: null,
      method: "Parcelas confirmadas", paymentMethod: "Cartão", context: "Pessoal",
      priority: "unclassified", confidence: "medium",
    });
    if (month?.loanTotalCents) items.push({
      canonicalId: `loans:${input.flow.month}`, kind: "loan", source: "loan",
      title: "Empréstimos debitados em conta", expectedAmount: money(month.loanTotalCents), realizedAmount: 0,
      planningAmount: money(month.loanTotalCents), cashEffect: true, includedInInvoice: false,
      includedInOtherTotal: false, deduplicationReason: null, expectedDate: null,
      method: "Contrato ativo", paymentMethod: "Conta bancária", context: "Pessoal",
      priority: "unclassified", confidence: "medium",
    });
  }
  return items;
}

export function getPlanningNextMonthSummary(input: { month: string; items: CanonicalPlanningItem[] }): PlanningNextMonthSummary {
  const income = input.items.filter(item => item.kind === "income" && item.cashEffect);
  const expenses = input.items.filter(item => ["expense", "invoice", "installment", "loan"].includes(item.kind) && item.cashEffect && item.planningAmount > 0);
  const expectedIncome = round(income.reduce((sum, item) => sum + item.planningAmount, 0));
  const expectedExpenses = round(expenses.reduce((sum, item) => sum + item.planningAmount, 0));
  const warnings: string[] = [];
  if (!expectedIncome) warnings.push("Sem base de renda prevista para calcular o comprometimento.");
  if (expenses.some(item => item.confidence === "low")) warnings.push("Há despesas com dados parciais ou baixa confiança.");
  if (income.some(item => item.confidence === "low")) warnings.push("Há receitas variáveis com pouco histórico.");
  const confidences = [...income, ...expenses].map(item => item.confidence);
  return {
    month: input.month.slice(0, 7), expectedIncome, expectedExpenses,
    estimatedFreeAmount: round(expectedIncome - expectedExpenses),
    committedPercentage: expectedIncome ? round(expectedExpenses / expectedIncome * 100) : null,
    expectedIncomeSourcesCount: income.length, expectedExpensesCount: expenses.length,
    cardInvoicesAmount: round(expenses.filter(item => item.kind === "invoice").reduce((sum, item) => sum + item.planningAmount, 0)),
    recurringExpensesAmount: round(expenses.filter(item => item.kind === "expense" && item.source !== "manual").reduce((sum, item) => sum + item.planningAmount, 0)),
    oneTimeExpensesAmount: round(expenses.filter(item => item.source === "manual").reduce((sum, item) => sum + item.planningAmount, 0)),
    dependentsAmount: round(expenses.filter(item => item.context !== "Pessoal" && item.context !== "Casa" && item.context !== "Trabalho" && item.context !== "Viagem").reduce((sum, item) => sum + item.planningAmount, 0)),
    householdAmount: round(expenses.filter(item => item.context === "Casa").reduce((sum, item) => sum + item.planningAmount, 0)),
    confidence: confidences.includes("low") ? "low" : confidences.includes("medium") ? "medium" : "high",
    warnings,
  };
}

export function getFinancialPlanningProjectionSeries(months: Array<{ month: string; items: CanonicalPlanningItem[] }>) {
  return months.map(getPlanningNextMonthSummary);
}

export function getPlanningAttentionItems(summary: PlanningNextMonthSummary, items: CanonicalPlanningItem[]): PlanningAttentionItem[] {
  const result: PlanningAttentionItem[] = [];
  if (summary.estimatedFreeAmount < 0) result.push({ id: "negative", severity: "critical", title: "Mês projetado no vermelho", description: "As despesas previstas superam a renda líquida esperada.", actionLabel: "Revisar despesas", href: "/financeiro/receitas-despesas" });
  if (!summary.expectedIncome) result.push({ id: "income-zero", severity: "critical", title: "Renda prevista sem base", description: "Cadastre uma receita ou ajuste sua fonte de renda.", actionLabel: "Revisar receita", href: "/financeiro/receitas-despesas" });
  if ((summary.committedPercentage ?? 0) > 100) result.push({ id: "overcommitted", severity: "critical", title: "Comprometimento acima de 100%", description: "O mês não possui renda suficiente para os compromissos conhecidos.", actionLabel: "Ver composição", href: "#composicao" });
  if (items.some(item => item.kind === "invoice" && item.dataQuality?.includes("parciais"))) result.push({ id: "invoice-partial", severity: "warning", title: "Fatura com dados parciais", description: "O último total confiável foi preservado na projeção.", actionLabel: "Revisar fatura", href: "/financeiro/cartoes" });
  const unclassified = items.filter(item => item.planningAmount > 0 && item.kind !== "income" && item.priority === "unclassified").length;
  if (unclassified) result.push({ id: "unclassified", severity: "warning", title: `${unclassified} item(ns) sem prioridade`, description: "Classifique para separar o que é essencial, ajustável ou opcional.", actionLabel: "Classificar", href: "/financeiro/receitas-despesas" });
  if (items.some(item => item.kind === "income" && item.confidence === "low")) result.push({ id: "income-history", severity: "info", title: "Receita variável com pouco histórico", description: "A projeção continuará disponível com confiança reduzida.", actionLabel: "Revisar receita", href: "/financeiro/receitas-despesas" });
  return result.slice(0, 6);
}

export function buildPlanningDashboard(input: {
  workspaceId: string; startMonth: string; horizon: 3 | 6 | 12; accountId: string | null;
  accounts: Array<{ id: string; name: string }>;
  months: Array<{ flow: IncomeExpensePageData; invoices?: FinanceOverviewInvoice[]; commitments?: MonthlyCommitmentProjection }>;
}): PlanningDashboard {
  const monthlySummaries = input.months.map(month => {
    const items = resolveCanonicalPlanningItems({ flow: month.flow, invoices: month.invoices, monthlyCommitments: month.commitments, accountId: input.accountId });
    return { summary: getPlanningNextMonthSummary({ month: month.flow.month, items }), items };
  });
  const first = monthlySummaries[0] ?? { summary: getPlanningNextMonthSummary({ month: input.startMonth, items: [] }), items: [] };
  const breakdownPriorities: PlanningPriority[] = ["essential", "adjustable", "optional", "unclassified"];
  const incomeCommitmentBreakdown = breakdownPriorities.map(priorityValue => {
    const amount = round(first.items.filter(item => item.priority === priorityValue && item.planningAmount > 0 && item.kind !== "income").reduce((sum, item) => sum + item.planningAmount, 0));
    return { priority: priorityValue, amount, percentage: first.summary.expectedIncome ? round(amount / first.summary.expectedIncome * 100) : null };
  });
  const warnings = [...new Set(monthlySummaries.flatMap(month => month.summary.warnings))];
  return {
    filters: { workspaceId: input.workspaceId, startMonth: input.startMonth.slice(0, 7), horizon: input.horizon, accountId: input.accountId, accounts: input.accounts },
    nextMonthSummary: first.summary, projectionSeries: monthlySummaries.map(month => month.summary), monthlySummaries,
    nextMonthIncome: first.items.filter(item => item.kind === "income"),
    nextMonthExpenses: first.items.filter(item => ["expense", "invoice", "installment", "loan"].includes(item.kind) && item.planningAmount > 0),
    payrollDeductionsInformational: first.items.filter(item => item.kind === "payroll"),
    incomeCommitmentBreakdown, attentionItems: getPlanningAttentionItems(first.summary, first.items),
    dataFreshness: first.summary.confidence, warnings,
  };
}
