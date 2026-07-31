import type {
  AccountMovementDailyPoint,
  BankAccountMonthlyMovement,
  BankAccountMovementItem,
} from "./account-movement";
import type { CurrentCardInvoice } from "./card-invoices";
import type { FinanceDashboard } from "./dashboard";
import type {
  IncomeExpenseListItem,
  IncomeExpensePageData,
} from "./income-expenses-query";
import type { ResolvedOpenCardInvoice } from "./open-card-invoice";

export type CurrentMonthFinanceSummary = {
  selectedMonth: string;
  currentBalance: number;
  currentBalanceUpdatedAt: string | null;
  currentBalanceFreshness: "complete" | "partial" | "stale" | "unavailable";
  currentMonthInflows: number;
  currentMonthInflowsCount: number;
  currentMonthOutflows: number;
  currentMonthOutflowsCount: number;
  currentMonthResult: number;
  previousMonthResult: number;
  variationPercentage: number | null;
  dataWarnings: string[];
};

export type FinanceOverviewInvoice = {
  id: string;
  name: string;
  lastFour: string | null;
  amount: number | null;
  ownerPayableAmount?: number | null;
  thirdPartyResponsibleAmount?: number;
  responsibleParties?: Array<{personId:string;personName:string;amount:number;cardFinals:string[]}>;
  status: string;
  closingDate: string | null;
  dueDate: string | null;
  partial: boolean;
  sourceLabel: string;
  confidence: "high" | "medium" | "low";
  href: string;
};

export type FinanceOverviewCommitment = {
  id: string;
  title: string;
  date: string | null;
  amount: number;
  context: string | null;
  status: string;
  direction: "income" | "expense";
  paymentMethod: string | null;
  paymentSource: string | null;
};

export type FinanceOverviewDistributionItem = {
  key: string;
  label: string;
  amount: number;
  percentage: number;
  count: number;
};

export type FinanceOverviewMainMovement = {
  id: string;
  title: string;
  amount: number;
};

export type NextMonthIncomeSource = {
  id: string;
  title: string;
  amount: number;
  estimationMethod: IncomeExpenseListItem["estimationMethod"];
  expectedDate: string | null;
};

export type NextMonthExpenseGroup = {
  id: string;
  title: string;
  amount: number;
  context: string | null;
  expectedDate: string | null;
  paymentMethod: string | null;
  paymentChannel: IncomeExpenseListItem["paymentChannel"];
};

export type NextMonthFinanceProjection = {
  month: string;
  expectedIncome: number;
  expectedExpenses: number;
  expectedCardInvoices: number;
  grossCardInvoices: number;
  thirdPartyCardInvoices: number;
  expectedCommitments: number;
  expectedResult: number;
  estimatedFreeAmount: number;
  projectedEndingBalance?: number;
  confidence: "high" | "medium" | "low";
  warnings: string[];
  incomeSources: NextMonthIncomeSource[];
  expenseGroups: NextMonthExpenseGroup[];
};

export type FollowingMonthSummary = {
  month: string;
  expectedIncome: number;
  expectedExpenses: number;
  expectedResult: number;
  confidence: "high" | "medium" | "low";
};

export type FinanceAttentionItem = {
  id: string;
  type: string;
  severity: "info" | "warning" | "critical";
  title: string;
  description?: string;
  actionLabel: string;
  href: string;
  count?: number;
};

export type FinanceOverviewDashboard = {
  selectedPeriod: {
    month: string;
    currentSummary: CurrentMonthFinanceSummary;
    cashFlowSeries: AccountMovementDailyPoint[];
    largestMovements: {
      largestInflow: BankAccountMovementItem | null;
      largestOutflow: BankAccountMovementItem | null;
    };
    currentInvoices: FinanceOverviewInvoice[];
    currentCommitments: FinanceOverviewCommitment[];
    spendingDistribution: FinanceOverviewDistributionItem[];
    uncategorizedCount: number;
    mainMovements: {
      inflows: FinanceOverviewMainMovement[];
      outflows: FinanceOverviewMainMovement[];
    };
    attentionItems: FinanceAttentionItem[];
  };
  nextPeriod: {
    month: string;
    projectionSummary: NextMonthFinanceProjection;
    expectedIncome: NextMonthIncomeSource[];
    expectedExpenses: NextMonthExpenseGroup[];
    upcomingCommitments: FinanceOverviewCommitment[];
    upcomingInvoices: FinanceOverviewInvoice[];
    payrollDeductions: FinanceOverviewCommitment[];
    attentionItems: FinanceAttentionItem[];
  };
  followingPeriods: FollowingMonthSummary[];
  dataFreshness: {
    account: string;
    transactions: string;
    cards: string;
    invoices: string;
  };
};

const moneyFromCents = (value: number) => value / 100;
const roundMoney = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const monthKey = (value: string | null) => value?.slice(0, 7) ?? null;
const terminalStatuses = new Set([
  "paid", "received", "above_expected", "below_expected", "cancelled", "skipped", "disputed",
]);

export function getCurrentMonthFinanceSummary(input: {
  selectedMonth: string;
  movement: BankAccountMonthlyMovement | null;
}): CurrentMonthFinanceSummary {
  const previousMonthResult = input.movement
    ? input.movement.previousMonthInflow - input.movement.previousMonthOutflow
    : 0;
  const currentMonthResult = input.movement?.netMovement ?? 0;
  return {
    selectedMonth: input.selectedMonth.slice(0, 7),
    currentBalance: input.movement?.currentBalance ?? 0,
    currentBalanceUpdatedAt: input.movement?.lastSyncAt ?? null,
    currentBalanceFreshness: input.movement?.dataCompleteness ?? "unavailable",
    currentMonthInflows: input.movement?.totalInflow ?? 0,
    currentMonthInflowsCount: input.movement?.inflowItems.length ?? 0,
    currentMonthOutflows: input.movement?.totalOutflow ?? 0,
    currentMonthOutflowsCount: input.movement?.outflowItems.length ?? 0,
    currentMonthResult,
    previousMonthResult,
    variationPercentage: previousMonthResult
      ? ((currentMonthResult - previousMonthResult) / Math.abs(previousMonthResult)) * 100
      : null,
    dataWarnings: [...(input.movement?.warnings ?? [])],
  };
}

export function getMonthlyBankCashFlowSeries(
  movement: BankAccountMonthlyMovement | null,
) {
  return movement?.dailySeries ?? [];
}

export function getLargestBankMovementsForPeriod(
  movement: BankAccountMonthlyMovement | null,
) {
  const byAmount = (left: BankAccountMovementItem, right: BankAccountMovementItem) =>
    right.amount - left.amount;
  return {
    largestInflow: movement?.inflowItems.toSorted(byAmount)[0] ?? null,
    largestOutflow: movement?.outflowItems.toSorted(byAmount)[0] ?? null,
  };
}

function invoiceAmount(
  invoice: CurrentCardInvoice,
  resolved: ResolvedOpenCardInvoice | undefined,
) {
  return resolved?.displayTotal ?? invoice.invoiceTotal ?? null;
}

function buildOverviewInvoices(input: {
  invoices: CurrentCardInvoice[];
  resolvedInvoices: Map<string, ResolvedOpenCardInvoice>;
  cardsPartial: boolean;
}) {
  return input.invoices.map(invoice => {
    const resolved = input.resolvedInvoices.get(invoice.card.id);
    const reliability = resolved?.totalReliability;
    const grossAmount=invoiceAmount(invoice,resolved);
    const grouped=new Map<string,{personId:string;personName:string;amount:number;cardFinals:string[]}>();
    for(const instrument of invoice.instrumentTotals){
      if(!instrument.responsiblePersonId||instrument.purchaseCount===0)continue;
      const current=grouped.get(instrument.responsiblePersonId)??{personId:instrument.responsiblePersonId,personName:instrument.responsiblePersonName??"Outra pessoa",amount:0,cardFinals:[]};
      current.amount=roundMoney(current.amount+instrument.netTotal);
      if(instrument.lastFour&&!current.cardFinals.includes(instrument.lastFour))current.cardFinals.push(instrument.lastFour);
      grouped.set(instrument.responsiblePersonId,current);
    }
    const responsibleParties=[...grouped.values()].filter(item=>item.amount>0);
    const thirdPartyResponsibleAmount=roundMoney(invoice.thirdPartyResponsibleTotal);
    return {
      id: invoice.card.id,
      name: invoice.card.name,
      lastFour: invoice.card.last_four_digits,
      amount: grossAmount,
      ownerPayableAmount:grossAmount===null?null:roundMoney(Math.max(0,grossAmount-thirdPartyResponsibleAmount)),
      thirdPartyResponsibleAmount,
      responsibleParties,
      status: resolved?.status ?? invoice.status,
      closingDate: resolved?.closingDate ?? invoice.cycle?.closingDate ?? null,
      dueDate: resolved?.dueDate ?? invoice.cycle?.dueDate ?? null,
      partial: input.cardsPartial || invoice.isPartial || resolved?.dataCompleteness === "partial",
      sourceLabel: resolved?.sourceLabel ?? "Estimativa pelas compras sincronizadas",
      confidence: reliability === "confirmed" || reliability === "reliable"
        ? "high" as const
        : reliability === "estimated" || invoice.calculatedValueReliable
          ? "medium" as const
          : "low" as const,
      href: `/financeiro/cartoes?card=${invoice.card.id}`,
    };
  });
}

export function partitionInvoicesByPeriod(
  invoices: FinanceOverviewInvoice[],
  selectedMonth: string,
  nextMonth: string,
) {
  const selectedKey = selectedMonth.slice(0, 7);
  const nextKey = nextMonth.slice(0, 7);
  return {
    currentInvoices: invoices.filter(invoice => invoice.dueDate
      ? monthKey(invoice.dueDate) === selectedKey
      : monthKey(invoice.closingDate) === selectedKey,
    ),
    upcomingInvoices: invoices.filter(invoice => monthKey(invoice.dueDate) === nextKey),
  };
}

export function getSpendingDestinationDistribution(input: {
  flow: IncomeExpensePageData;
  legacyDashboard: FinanceDashboard;
}) {
  const fromContexts = input.flow.dashboard.contextDistribution.map(item => ({
    ...item,
    amount: moneyFromCents(item.amount),
    count: input.flow.expenses.filter(expense => {
      if (item.key === "dependents") return expense.personNames.length > 0;
      return expense.personNames.length === 0 && expense.contextType === item.key;
    }).length,
  }));
  if (fromContexts.length) return fromContexts;
  return input.legacyDashboard.expenseCategories
    .filter(item => item.name !== "Sem categoria")
    .slice(0, 5)
    .map(item => ({
      key: item.name.toLocaleLowerCase("pt-BR"),
      label: item.name,
      amount: item.value,
      percentage: item.percentage,
      count: 0,
    }));
}

function commitmentContext(item: IncomeExpenseListItem) {
  return item.personNames[0] ?? item.categoryName ??
    ({ personal: "Pessoal", household: "Casa", work: "Trabalho", travel: "Viagem" } as const)[item.contextType];
}

function commitmentFromItem(item: IncomeExpenseListItem): FinanceOverviewCommitment {
  return {
    id: item.occurrenceId ?? item.id,
    title: item.title,
    date: item.expectedDate,
    amount: moneyFromCents(item.realizedAmountCents || item.expectedAmountCents),
    context: commitmentContext(item),
    status: item.occurrenceStatus,
    direction: item.direction,
    paymentMethod: item.paymentMethod,
    paymentSource: item.paymentSourceName,
  };
}

const remainingItemCents = (item: IncomeExpenseListItem) =>
  terminalStatuses.has(item.occurrenceStatus)
    ? 0
    : Math.max(item.expectedAmountCents - item.realizedAmountCents, 0);

export function getNextMonthFinanceProjection(input: {
  month: string;
  flow: IncomeExpensePageData;
  upcomingInvoices: FinanceOverviewInvoice[];
  currentBalance?: number;
}): NextMonthFinanceProjection {
  const expectedIncome = moneyFromCents(input.flow.overview.expectedIncomeCents);
  const cardCommitmentsCents = input.flow.expenses
    .filter(item => item.paymentChannel === "card" && !item.isPayrollDeduction)
    .reduce((sum, item) => sum + remainingItemCents(item), 0);
  const expectedCardInvoices = input.upcomingInvoices.reduce(
    (sum, invoice) => sum + (invoice.ownerPayableAmount ?? invoice.amount ?? 0),
    0,
  );
  const grossCardInvoices=input.upcomingInvoices.reduce((sum,invoice)=>sum+(invoice.amount??0),0);
  const thirdPartyCardInvoices=input.upcomingInvoices.reduce((sum,invoice)=>sum+(invoice.thirdPartyResponsibleAmount??0),0);
  const canonicalCashExpenses = moneyFromCents(input.flow.overview.expectedExpenseCents);
  const expectedCommitments = Math.max(
    canonicalCashExpenses - moneyFromCents(cardCommitmentsCents),
    0,
  );
  const cardCashOutflow = expectedCardInvoices || moneyFromCents(cardCommitmentsCents);
  const expectedExpenses = roundMoney(expectedCommitments + cardCashOutflow);
  const expectedResult = roundMoney(expectedIncome - expectedExpenses);
  const history = input.flow.incomes.map(item => item.historicalMonthsCount);
  const confidence = input.upcomingInvoices.some(invoice => invoice.confidence === "low")
    ? "low" as const
    : history.some(months => months >= 3)
      ? "medium" as const
      : "low" as const;
  const warnings: string[] = [];
  if (!expectedCardInvoices && cardCommitmentsCents) {
    warnings.push("Faturas futuras indisponíveis; compromissos no cartão usados como estimativa.");
  }
  if (input.flow.incomes.some(item => item.estimationMethod === "historical_median" && item.historicalMonthsCount < 3)) {
    warnings.push("Há receitas previstas com pouco histórico.");
  }
  return {
    month: input.month.slice(0, 7),
    expectedIncome,
    expectedExpenses,
    expectedCardInvoices,
    grossCardInvoices,
    thirdPartyCardInvoices,
    expectedCommitments,
    expectedResult,
    estimatedFreeAmount: expectedResult,
    projectedEndingBalance: input.currentBalance === undefined
      ? undefined
      : roundMoney(input.currentBalance + expectedResult),
    confidence,
    warnings,
    incomeSources: input.flow.incomes
      .filter(item => !terminalStatuses.has(item.occurrenceStatus))
      .map(item => ({
        id: item.id,
        title: item.title,
        amount: moneyFromCents(remainingItemCents(item)),
        estimationMethod: item.estimationMethod,
        expectedDate: item.expectedDate,
      }))
      .filter(item => item.amount > 0)
      .sort((left, right) => right.amount - left.amount),
    expenseGroups: input.flow.expenses
      .filter(item => !item.isPayrollDeduction && !terminalStatuses.has(item.occurrenceStatus))
      .map(item => ({
        id: item.id,
        title: item.title,
        amount: moneyFromCents(remainingItemCents(item)),
        context: commitmentContext(item),
        expectedDate: item.expectedDate,
        paymentMethod: item.paymentMethod,
        paymentChannel: item.paymentChannel,
      }))
      .filter(item => item.amount > 0)
      .sort((left, right) => right.amount - left.amount),
  };
}

export function getFollowingMonthsSummary(
  months: IncomeExpensePageData[],
): FollowingMonthSummary[] {
  return months.slice(0, 2).map(flow => {
    const expectedIncome = moneyFromCents(flow.overview.expectedIncomeCents);
    const expectedExpenses = moneyFromCents(flow.overview.expectedExpenseCents);
    return {
      month: flow.month.slice(0, 7),
      expectedIncome,
      expectedExpenses,
      expectedResult: expectedIncome - expectedExpenses,
      confidence: flow.incomes.some(item => item.historicalMonthsCount >= 3) ? "medium" : "low",
    };
  });
}

export function getCurrentMonthAttentionItems(input: {
  movement: BankAccountMonthlyMovement | null;
  invoices: FinanceOverviewInvoice[];
  uncategorizedCount: number;
  commitments: FinanceOverviewCommitment[];
}) {
  const items: FinanceAttentionItem[] = [];
  if (input.movement && input.movement.dataCompleteness !== "complete") {
    items.push({
      id: "bank-sync", type: "sync", severity: "warning",
      title: "Dados bancários parcialmente atualizados",
      actionLabel: "Ver integração", href: "/financeiro/integracoes",
    });
  }
  if ((input.movement?.netMovement ?? 0) < 0) {
    items.push({
      id: "negative-result", type: "cashflow", severity: "warning",
      title: "O período terminou com mais saídas do que entradas",
      actionLabel: "Ver movimentações", href: "/financeiro/movimentacoes",
    });
  }
  if (input.uncategorizedCount > 0) {
    items.push({
      id: "uncategorized", type: "classification", severity: "warning",
      title: `${input.uncategorizedCount} movimentações sem categoria`,
      actionLabel: "Revisar", href: "/financeiro/movimentacoes?review=pending",
      count: input.uncategorizedCount,
    });
  }
  const partialInvoices = input.invoices.filter(invoice => invoice.partial).length;
  if (partialInvoices) {
    items.push({
      id: "partial-invoices", type: "invoice", severity: "warning",
      title: `${partialInvoices} ${partialInvoices === 1 ? "fatura com dados parciais" : "faturas com dados parciais"}`,
      actionLabel: "Ver detalhes", href: "/financeiro/cartoes", count: partialInvoices,
    });
  }
  const overdue = input.commitments.filter(item => ["overdue", "late"].includes(item.status)).length;
  if (overdue) {
    items.push({
      id: "overdue-commitments", type: "commitment", severity: "critical",
      title: `${overdue} ${overdue === 1 ? "compromisso atrasado" : "compromissos atrasados"}`,
      actionLabel: "Revisar", href: "/financeiro/receitas-despesas", count: overdue,
    });
  }
  return items.slice(0, 5);
}

export function getNextMonthAttentionItems(
  projection: NextMonthFinanceProjection,
  invoices: FinanceOverviewInvoice[],
) {
  const items: FinanceAttentionItem[] = [];
  if (projection.expectedResult < 0) {
    items.push({
      id: "next-negative", type: "projection", severity: "critical",
      title: "Próximo mês projetado no vermelho",
      actionLabel: "Revisar planejamento", href: "/financeiro/planejamento",
    });
  }
  if (invoices.some(invoice => invoice.partial)) {
    items.push({
      id: "next-invoice-partial", type: "invoice", severity: "warning",
      title: "Fatura prevista ainda possui dados parciais",
      actionLabel: "Ver cartões", href: "/financeiro/cartoes",
    });
  }
  if (projection.warnings.length) {
    items.push({
      id: "next-confidence", type: "projection", severity: "info",
      title: projection.warnings[0]!,
      actionLabel: "Ver planejamento", href: "/financeiro/planejamento",
    });
  }
  return items;
}

export function buildFinanceOverviewDashboard(input: {
  selectedMonth: string;
  nextMonth: string;
  movement: BankAccountMonthlyMovement | null;
  invoices: CurrentCardInvoice[];
  resolvedInvoices: Map<string, ResolvedOpenCardInvoice>;
  currentFlow: IncomeExpensePageData;
  futureFlows: IncomeExpensePageData[];
  legacyDashboard: FinanceDashboard;
  cardsPartial: boolean;
}): FinanceOverviewDashboard {
  const allInvoices = buildOverviewInvoices(input);
  const { currentInvoices, upcomingInvoices } = partitionInvoicesByPeriod(
    allInvoices,
    input.selectedMonth,
    input.nextMonth,
  );
  const currentSummary = getCurrentMonthFinanceSummary({
    selectedMonth: input.selectedMonth,
    movement: input.movement,
  });
  const currentItems = [
    ...input.currentFlow.incomes,
    ...input.currentFlow.expenses,
    ...input.currentFlow.payrollDeductions,
  ];
  const currentCommitments = currentItems
    .filter(item => item.competenceMonth.slice(0, 7) === input.selectedMonth.slice(0, 7))
    .map(commitmentFromItem)
    .sort((left, right) => (left.date ?? "9999").localeCompare(right.date ?? "9999"))
    .slice(0, 6);
  const spendingDistribution = getSpendingDestinationDistribution({
    flow: input.currentFlow,
    legacyDashboard: input.legacyDashboard,
  });
  const movementItems = [
    ...(input.movement?.inflowItems ?? []),
    ...(input.movement?.outflowItems ?? []),
  ];
  const uncategorizedCount = movementItems.filter(item => item.category === "Sem categoria").length;
  const nextFlow = input.futureFlows[0];
  if (!nextFlow) throw new Error("A projeção do próximo mês não foi carregada.");
  const projectionSummary = getNextMonthFinanceProjection({
    month: input.nextMonth,
    flow: nextFlow,
    upcomingInvoices,
    currentBalance: currentSummary.currentBalance,
  });
  const upcomingCommitments = nextFlow.upcoming
    .filter(item => item.direction === "expense" && !item.isPayrollDeduction)
    .map(commitmentFromItem)
    .slice(0, 5);
  const payrollDeductions = nextFlow.payrollDeductions.map(commitmentFromItem);
  return {
    selectedPeriod: {
      month: input.selectedMonth.slice(0, 7),
      currentSummary,
      cashFlowSeries: getMonthlyBankCashFlowSeries(input.movement),
      largestMovements: getLargestBankMovementsForPeriod(input.movement),
      currentInvoices,
      currentCommitments,
      spendingDistribution,
      uncategorizedCount,
      mainMovements: {
        inflows: (input.movement?.inflowItems ?? []).toSorted((a, b) => b.amount - a.amount)
          .slice(0, 4).map(item => ({ id: item.id, title: item.description, amount: item.amount })),
        outflows: (input.movement?.outflowItems ?? []).toSorted((a, b) => b.amount - a.amount)
          .slice(0, 4).map(item => ({ id: item.id, title: item.description, amount: item.amount })),
      },
      attentionItems: getCurrentMonthAttentionItems({
        movement: input.movement,
        invoices: currentInvoices,
        uncategorizedCount,
        commitments: currentCommitments,
      }),
    },
    nextPeriod: {
      month: input.nextMonth.slice(0, 7),
      projectionSummary,
      expectedIncome: projectionSummary.incomeSources,
      expectedExpenses: projectionSummary.expenseGroups,
      upcomingCommitments,
      upcomingInvoices,
      payrollDeductions,
      attentionItems: getNextMonthAttentionItems(projectionSummary, upcomingInvoices),
    },
    followingPeriods: getFollowingMonthsSummary(input.futureFlows.slice(1)),
    dataFreshness: {
      account: input.movement?.dataCompleteness ?? "unavailable",
      transactions: input.movement?.dataCompleteness ?? "unavailable",
      cards: input.cardsPartial ? "partial" : "complete",
      invoices: allInvoices.some(invoice => invoice.partial) ? "partial" : "complete",
    },
  };
}
