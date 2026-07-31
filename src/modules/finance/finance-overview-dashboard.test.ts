import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  getCurrentMonthAttentionItems,
  getCurrentMonthFinanceSummary,
  getFollowingMonthsSummary,
  getLargestBankMovementsForPeriod,
  getMonthlyBankCashFlowSeries,
  getNextMonthFinanceProjection,
  partitionInvoicesByPeriod,
} from "./finance-overview-dashboard";
import type { BankAccountMonthlyMovement } from "./account-movement";
import type {
  IncomeExpenseListItem,
  IncomeExpensePageData,
} from "./income-expenses-query";

const movementItem = (id: string, amount: number, direction: "inflow" | "outflow") => ({
  id, externalId: id, date: "2026-07-10", description: id, amount, direction,
  nature: "bank", category: "Outros", origin: "Pluggy", source: "pluggy",
  status: "realized", reviewStatus: "reviewed", financialRole: null,
  classificationSource: null, classificationConfidence: null,
});

const movement = {
  currentBalance: 8_090.76,
  totalInflow: 48_923.92,
  totalOutflow: 54_445.32,
  netMovement: -5_521.40,
  previousMonthInflow: 20_000,
  previousMonthOutflow: 18_000,
  lastSyncAt: "2026-07-31T12:00:00Z",
  warnings: [],
  inflowItems: [movementItem("salario", 48_000, "inflow"), movementItem("pix", 923.92, "inflow")],
  outflowItems: [movementItem("fatura", 54_000, "outflow"), movementItem("cafe", 445.32, "outflow")],
  dailySeries: [{ date: "2026-07-01", label: "01", dailyInflow: 0, dailyOutflow: 0, cumulativeInflow: 0, cumulativeOutflow: 0 }],
  dataCompleteness: "complete",
} as unknown as BankAccountMonthlyMovement;

function plannedItem(input: Partial<IncomeExpenseListItem> & Pick<IncomeExpenseListItem, "id" | "title" | "direction" | "expectedAmountCents">): IncomeExpenseListItem {
  return {
    occurrenceId: input.id,
    categoryId: null,
    accountId: null,
    cardId: null,
    personId: null,
    description: null,
    recurrenceFrequency: "monthly",
    expectedDateDay: 10,
    estimationMethod: "fixed",
    aggregationMode: "single_occurrence",
    contextType: "personal",
    status: "active",
    realizedAmountCents: 0,
    differenceCents: -input.expectedAmountCents,
    occurrenceStatus: "projected",
    competenceMonth: "2026-08-01",
    expectedDate: "2026-08-10",
    paymentDate: null,
    paymentMethod: "pix",
    paymentSourceName: null,
    settlementSource: null,
    linkedInvoiceId: null,
    linkedTransactionId: null,
    creditsCount: 0,
    historicalMedianCents: null,
    historicalAverageCents: null,
    historicalMonthsCount: 0,
    incomeBasis: input.direction === "income" ? "net" : null,
    cashFlowEffect: input.direction === "income" ? "inflow" : "outflow",
    planningEffect: input.direction === "income" ? "increase" : "decrease",
    analyticsEffect: input.direction === "income" ? "income" : "expense",
    paymentChannel: "bank",
    isPayrollDeduction: false,
    categoryName: null,
    personNames: [],
    ...input,
  };
}

function flow(month: string, income: number, expenses: number, items: IncomeExpenseListItem[] = []): IncomeExpensePageData {
  return {
    workspaceId: "workspace", month: `${month}-01`,
    incomes: items.filter(item => item.direction === "income"),
    expenses: items.filter(item => item.direction === "expense" && !item.isPayrollDeduction),
    payrollDeductions: items.filter(item => item.isPayrollDeduction),
    upcoming: items.filter(item => !item.isPayrollDeduction),
    overview: {
      expectedIncomeCents: income * 100, receivedIncomeCents: 0,
      expectedExpenseCents: expenses * 100, paidExpenseCents: 0,
      projectedBalanceCents: (income - expenses) * 100, realizedBalanceCents: 0,
    },
    dashboard: {
      summary: {} as IncomeExpensePageData["dashboard"]["summary"],
      cumulativeSeries: [], financialEvents: [], contextDistribution: [],
      topIncome: [], topExpenses: [], warnings: [],
    },
  };
}

test("saldo positivo permanece separado do resultado mensal negativo", () => {
  const summary = getCurrentMonthFinanceSummary({ selectedMonth: "2026-07", movement });
  assert.equal(summary.currentBalance, 8_090.76);
  assert.equal(summary.currentMonthInflows, 48_923.92);
  assert.equal(summary.currentMonthOutflows, 54_445.32);
  assert.equal(summary.currentMonthResult, -5_521.40);
  assert.equal(summary.currentMonthInflowsCount, 2);
  assert.equal(summary.currentMonthOutflowsCount, 2);
});

test("resumo realizado recebe somente mês selecionado e movimentação bancária", () => {
  const source = getCurrentMonthFinanceSummary.toString();
  assert.match(source, /selectedMonth/);
  assert.doesNotMatch(source, /expected|future|invoice|freeToSpend/);
});

test("livre estimado de agosto é o resultado previsto sem saldo atual", () => {
  const august = flow("2026-08", 16_240.38, 12_833.23);
  const projection = getNextMonthFinanceProjection({
    month: "2026-08",
    flow: august,
    upcomingInvoices: [],
    currentBalance: 8_090.76,
  });
  assert.equal(projection.expectedResult, 3_407.15);
  assert.equal(projection.estimatedFreeAmount, 3_407.15);
  assert.equal(projection.projectedEndingBalance, 11_497.91);
  assert.notEqual(projection.estimatedFreeAmount, projection.projectedEndingBalance);
});

test("fatura do próximo mês substitui compromissos de cartão sem duplicar", () => {
  const cardExpense = plannedItem({
    id: "wellhub", title: "WellHub", direction: "expense",
    expectedAmountCents: 30_000, paymentChannel: "card", paymentMethod: "credit_card",
  });
  const bankExpense = plannedItem({
    id: "school", title: "Escola", direction: "expense", expectedAmountCents: 100_000,
  });
  const projection = getNextMonthFinanceProjection({
    month: "2026-08",
    flow: flow("2026-08", 2000, 1300, [cardExpense, bankExpense]),
    upcomingInvoices: [{
      id: "card", name: "Cartão", lastFour: "5718", amount: 500,
      status: "open", closingDate: "2026-08-03", dueDate: "2026-08-10",
      partial: false, sourceLabel: "Pluggy", confidence: "high", href: "/cartoes",
    }],
  });
  assert.equal(projection.expectedCommitments, 1000);
  assert.equal(projection.expectedCardInvoices, 500);
  assert.equal(projection.expectedExpenses, 1500);
});

test("projeção desconta cartões pagos por outra pessoa e preserva a fatura bruta",()=>{
  const projection=getNextMonthFinanceProjection({
    month:"2026-08",
    flow:flow("2026-08",2000,0,[]),
    upcomingInvoices:[{
      id:"card",name:"Cartão",lastFour:"5718",amount:500,ownerPayableAmount:350,
      thirdPartyResponsibleAmount:150,responsibleParties:[{personId:"jessica",personName:"Jéssica",amount:150,cardFinals:["0613","5991"]}],
      status:"open",closingDate:"2026-08-03",dueDate:"2026-08-10",partial:false,
      sourceLabel:"Pluggy",confidence:"high",href:"/cartoes",
    }],
  });
  assert.equal(projection.grossCardInvoices,500);
  assert.equal(projection.thirdPartyCardInvoices,150);
  assert.equal(projection.expectedCardInvoices,350);
  assert.equal(projection.expectedExpenses,350);
});

test("fatura que fecha em julho e vence em agosto pertence somente a agosto", () => {
  const invoice = {
    id: "card", name: "Cartão", lastFour: "5718", amount: 7_000,
    status: "open", closingDate: "2026-07-31", dueDate: "2026-08-10",
    partial: false, sourceLabel: "Pluggy", confidence: "high" as const,
    href: "/cartoes",
  };
  const partition = partitionInvoicesByPeriod([invoice], "2026-07", "2026-08");
  assert.equal(partition.currentInvoices.length, 0);
  assert.equal(partition.upcomingInvoices.length, 1);
});

test("desconto em folha não reduz a projeção novamente", () => {
  const payroll = plannedItem({
    id: "pension", title: "Pensão", direction: "expense", expectedAmountCents: 243_150,
    isPayrollDeduction: true, paymentChannel: "payroll", cashFlowEffect: "none",
    planningEffect: "informational",
  });
  const projection = getNextMonthFinanceProjection({
    month: "2026-08", flow: flow("2026-08", 10_000, 0, [payroll]), upcomingInvoices: [],
  });
  assert.equal(projection.expectedExpenses, 0);
  assert.equal(projection.estimatedFreeAmount, 10_000);
});

test("maior entrada, maior saída e fluxo usam somente movimento bancário", () => {
  const largest = getLargestBankMovementsForPeriod(movement);
  assert.equal(largest.largestInflow?.id, "salario");
  assert.equal(largest.largestOutflow?.id, "fatura");
  assert.equal(getMonthlyBankCashFlowSeries(movement)[0]?.cumulativeInflow, 0);
});

test("meses seguintes não repetem o próximo mês destacado", () => {
  const following = getFollowingMonthsSummary([
    flow("2026-09", 9_000, 5_000), flow("2026-10", 8_000, 7_000),
  ]);
  assert.deepEqual(following.map(item => item.month), ["2026-09", "2026-10"]);
  assert.deepEqual(following.map(item => item.expectedResult), [4_000, 1_000]);
});

test("alertas do mês vigente são acionáveis e não usam projeção futura", () => {
  const items = getCurrentMonthAttentionItems({
    movement: { ...movement, dataCompleteness: "partial" },
    invoices: [], uncategorizedCount: 3, commitments: [],
  });
  assert.ok(items.some(item => item.id === "negative-result"));
  assert.ok(items.every(item => item.actionLabel && item.href));
  assert.ok(items.every(item => !item.id.startsWith("next-")));
});

test("interface separa realizado e previsão com quatro cards em cada seção", () => {
  const source = readFileSync("src/components/finance/finance-overview.tsx", "utf8");
  assert.match(source, /CurrentMonthSection/);
  assert.match(source, /NextMonthSection/);
  assert.match(source, /— realizado/);
  assert.match(source, /— previsão/);
  assert.equal(source.match(/<CurrentMonthSummaryCard/g)?.length, 4);
  assert.equal(source.match(/<ProjectionCard/g)?.length, 4);
  assert.doesNotMatch(source, /Ainda previsto|Livre para gastar ou guardar/);
  assert.match(source, /Sobra prevista sem somar o saldo atual/);
});

test("cache separa realizado, próximo mês, caixa e projeção", () => {
  const source = readFileSync("src/modules/finance/commitments-cache.ts", "utf8");
  for (const tag of ["finance:overview:current", "finance:overview:next", "finance:cashflow", "finance:projection"]) {
    assert.match(source, new RegExp(tag));
  }
});

test("layout diferencia próximo mês e cobre desktop, tablet e mobile", () => {
  const css = readFileSync("src/app/globals.css", "utf8");
  assert.match(css, /\.fov-next-period/);
  assert.match(css, /\.fov-next-grid\{display:grid;grid-template-columns:repeat\(4/);
  assert.match(css, /@media\(max-width:1100px\)/);
  assert.match(css, /@media\(max-width:520px\)/);
});
