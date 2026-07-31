import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  calculatePersonMonthlySpend,
  calculatePersonSpendForPeriod,
  calculateVariation,
  canonicalPersonEntries,
  getPersonCategoryBreakdown,
  getPersonMonthlyAverage,
  getPersonMonthlyTrend,
  resolvePersonDashboardPeriod,
  selectPersonFinancialDashboard,
  type PersonDashboardEntry,
  type PersonFinancialDashboardData,
} from "./person-financial-dashboard";

const expense = (
  id: string,
  amountCents: number,
  overrides: Partial<PersonDashboardEntry> = {},
): PersonDashboardEntry => ({
  id,
  canonicalKey: `transaction:${id}`,
  sourceType: "bank_transaction",
  date: "2026-07-10",
  description: id,
  amountCents,
  categoryId: "other",
  categoryName: "Outros",
  accountId: "account",
  accountName: "Conta",
  direction: "outflow",
  status: "realized",
  linkSource: "manual",
  financialNature: "purchase",
  financialRole: "expense",
  personFlowRole: null,
  reimbursementRole: null,
  incomeEffect: "normal",
  recurrenceType: "extraordinary",
  commitmentId: null,
  linkedTransactionId: id,
  linkedCardPurchaseId: null,
  isConfirmedExpense: true,
  isPix: false,
  isReimbursement: false,
  isUnclassifiedPix: false,
  ...overrides,
});

const fixtureEntries: PersonDashboardEntry[] = [
  expense("escola", 121_000, {
    description: "Escola",
    categoryId: "education",
    categoryName: "Educação",
    recurrenceType: "recurring",
    sourceType: "commitment",
    canonicalKey: "occurrence:escola",
    linkedTransactionId: null,
    commitmentId: "school",
    status: "paid",
  }),
  expense("ingles", 32_500, {
    description: "Inglês",
    categoryId: "education",
    categoryName: "Educação",
    recurrenceType: "recurring",
    sourceType: "commitment",
    canonicalKey: "occurrence:ingles",
    linkedTransactionId: null,
    commitmentId: "english",
    status: "paid",
  }),
  expense("pix-eventual", 20_000, {
    description: "Pix eventual",
    financialNature: "pix_sent",
    personFlowRole: "sent_to_person",
    isPix: true,
  }),
];

const dashboardData = (
  entries: PersonDashboardEntry[] = fixtureEntries,
): PersonFinancialDashboardData => ({
  person: {
    id: "daughter",
    workspaceId: "workspace",
    name: "Filha",
    relationType: "child",
    isDependent: true,
    isActive: true,
    colorKey: null,
    notes: null,
  },
  entries,
  reimbursements: [],
  allocations: [],
  upcomingCommitments: [],
  counterpartyLinks: [],
  dataQualityWarnings: [],
  generatedAt: "2026-07-29T12:00:00.000Z",
});

test("calcula gasto mensal bruto, líquido, recorrente e extraordinário", () => {
  const result = calculatePersonMonthlySpend({
    entries: fixtureEntries,
    from: "2026-07-01",
    to: "2026-07-31",
  });
  assert.equal(result.grossSpent, 173_500);
  assert.equal(result.netSpent, 173_500);
  assert.equal(result.recurringSpent, 153_500);
  assert.equal(result.extraordinarySpent, 20_000);
  assert.equal(result.pixSentClassifiedAsExpense, 20_000);
});

test("resolver central exclui salário, entrada comum e Pix não classificado", () => {
  const data = dashboardData([
    expense("escola", 121_000, { recurrenceType: "recurring" }),
    expense("salario", 1_081_604, {
      direction: "inflow",
      financialNature: "salary",
      financialRole: "income",
      isConfirmedExpense: false,
    }),
    expense("pix-recebido", 47_000, {
      direction: "inflow",
      financialNature: "pix_received",
      isPix: true,
      isConfirmedExpense: false,
      isUnclassifiedPix: true,
    }),
  ]);
  data.upcomingCommitments = [{
    id: "future",
    title: "Escola",
    categoryName: "Educação",
    dueDate: "2026-08-10",
    amountCents: 121_000,
    recurrenceType: "recurring",
    paymentMethod: "pix",
    status: "projected",
  }];
  const result = calculatePersonSpendForPeriod({
    workspaceId: "workspace",
    personId: "daughter",
    periodStart: "2026-07-01",
    periodEnd: "2026-07-31",
    data,
  });
  assert.equal(result.grossSpent, 121_000);
  assert.equal(result.netSpent, 121_000);
  assert.equal(result.futureCommitments, 121_000);
  assert.equal(result.transactionCount, 1);
});

test("resolver central não aceita pessoa self como dimensão de gasto", () => {
  const data = dashboardData([expense("academia", 11_138)]);
  data.person.relationType = "self";
  const result = calculatePersonSpendForPeriod({
    workspaceId: "workspace",
    personId: "daughter",
    periodStart: "2026-07-01",
    periodEnd: "2026-07-31",
    data,
  });
  assert.equal(result.netSpent, 0);
  assert.equal(result.transactionCount, 0);
});

test("reembolso confirmado reduz somente o custo líquido", () => {
  const result = calculatePersonMonthlySpend({
    entries: [expense("shared", 30_000)],
    reimbursements: [{
      id: "refund",
      date: "2026-07-20",
      amountCents: 15_000,
      status: "fully_allocated",
      isConfirmed: true,
      allocatedAmountCents: 15_000,
    }],
    from: "2026-07-01",
    to: "2026-07-31",
  });
  assert.equal(result.grossSpent, 30_000);
  assert.equal(result.reimbursedAmount, 15_000);
  assert.equal(result.netSpent, 15_000);
});

test("Pix recebido comum não reduz gasto e Pix enviado sem classificação não entra", () => {
  const entries = [
    expense("received", 50_000, {
      direction: "inflow",
      financialNature: "pix_received",
      personFlowRole: "received_from_person",
      isPix: true,
      isConfirmedExpense: false,
      isUnclassifiedPix: true,
    }),
    expense("sent", 20_000, {
      financialNature: "pix_sent",
      personFlowRole: null,
      isPix: true,
      isConfirmedExpense: false,
      isUnclassifiedPix: true,
    }),
  ];
  const result = calculatePersonMonthlySpend({
    entries,
    from: "2026-07-01",
    to: "2026-07-31",
  });
  assert.equal(result.netSpent, 0);
  assert.equal(result.unclassifiedPixAmount, 70_000);
});

test("Pix recebido só aparece como reembolso quando classificado", () => {
  const result = calculatePersonMonthlySpend({
    entries: [expense("refund-pix", 15_000, {
      direction: "inflow",
      financialNature: "pix_received",
      personFlowRole: "reimbursement_received",
      reimbursementRole: "reimbursement",
      incomeEffect: "neutral",
      isPix: true,
      isReimbursement: true,
      isConfirmedExpense: false,
    })],
    from: "2026-07-01",
    to: "2026-07-31",
  });
  assert.equal(result.pixReceivedAsReimbursement, 15_000);
  assert.equal(result.grossSpent, 0);
});

test("pagamento da fatura e ocorrência vinculada não duplicam compra no cartão", () => {
  const canonical = canonicalPersonEntries([
    expense("purchase", 10_000, {
      sourceType: "card_purchase",
      canonicalKey: "card:purchase",
      linkedTransactionId: null,
      linkedCardPurchaseId: "purchase",
    }),
    expense("occurrence", 10_000, {
      sourceType: "commitment",
      canonicalKey: "card:purchase",
      linkedTransactionId: null,
      linkedCardPurchaseId: "purchase",
      status: "paid",
    }),
    expense("invoice-payment", 10_000, {
      financialNature: "invoice_payment",
      isConfirmedExpense: false,
    }),
  ]);
  const result = calculatePersonMonthlySpend({
    entries: canonical,
    from: "2026-07-01",
    to: "2026-07-31",
  });
  assert.equal(result.grossSpent, 10_000);
  assert.equal(canonical.length, 2);
});

test("desconto em folha pago entra como recorrente", () => {
  const result = calculatePersonMonthlySpend({
    entries: [expense("payroll", 35_000, {
      sourceType: "commitment",
      canonicalKey: "occurrence:payroll",
      linkedTransactionId: null,
      financialNature: "payroll",
      linkSource: "payroll",
      recurrenceType: "recurring",
      status: "paid",
    })],
    from: "2026-07-01",
    to: "2026-07-31",
  });
  assert.equal(result.recurringSpent, 35_000);
});

test("média inclui todos os meses de janelas de 3, 6 e 12 meses", () => {
  for (const months of [3, 6, 12]) {
    const monthlyValues = Array.from({ length: months }, (_, index) => ({
      month: `2026-${String(index + 1).padStart(2, "0")}`,
      grossSpent: index === 0 ? 12_000 : 0,
      reimbursedAmount: 0,
      netSpent: index === 0 ? 12_000 : 0,
      recurringSpent: index === 0 ? 9_000 : 0,
      extraordinarySpent: index === 0 ? 3_000 : 0,
      pixSentClassifiedAsExpense: 0,
      pixReceivedAsReimbursement: 0,
      unclassifiedPixAmount: 0,
      transactionCount: index === 0 ? 1 : 0,
    }));
    const average = getPersonMonthlyAverage({ monthlyValues });
    assert.equal(average.monthsConsidered, months);
    assert.equal(average.averageMonthlySpent, 12_000 / months);
    assert.equal(average.activeMonths, 1);
  }
});

test("tendência cria meses sem gasto dentro da janela", () => {
  const trend = getPersonMonthlyTrend({
    entries: [expense("march", 10_000, { date: "2026-03-10" })],
    from: "2026-01-01",
    to: "2026-03-31",
  });
  assert.deepEqual(trend.map(point => point.netSpent), [0, 0, 10_000]);
});

test("variação evita infinito quando o mês anterior é zero", () => {
  assert.deepEqual(calculateVariation(10_000, 0), {
    amount: 10_000,
    percentage: null,
  });
  assert.equal(calculateVariation(11_000, 10_000).percentage, 10);
});

test("categorias calculam total, percentual e recorrência", () => {
  const movements = fixtureEntries.map(entry => ({
    ...entry,
    displayType: "Despesa",
  }));
  const categories = getPersonCategoryBreakdown(movements);
  assert.equal(categories[0].categoryName, "Educação");
  assert.equal(categories[0].total, 153_500);
  assert.equal(categories[0].recurringAmount, 153_500);
  assert.ok(Math.abs(categories[0].percentage - 88.4726) < 0.01);
  assert.equal(categories[1].total, 20_000);
});

test("dashboard anual encontra mês mais caro, mais barato e média", () => {
  const entries = [
    expense("january", 10_000, { date: "2026-01-10" }),
    expense("february", 20_000, { date: "2026-02-10" }),
    expense("july", 30_000, { date: "2026-07-10" }),
  ];
  const dashboard = selectPersonFinancialDashboard({
    data: dashboardData(entries),
    period: resolvePersonDashboardPeriod("this_month", "2026-07"),
    referenceMonth: "2026-07",
  });
  assert.equal(dashboard.annualSummary.totalSpent, 60_000);
  assert.equal(dashboard.annualSummary.mostExpensiveMonth?.month, "2026-07");
  assert.equal(dashboard.annualSummary.leastExpensiveMonth?.month, "2026-01");
  assert.equal(dashboard.annualSummary.averageMonthly, Math.round(60_000 / 7));
});

test("compromissos futuros não entram no gasto realizado", () => {
  const data = dashboardData();
  data.upcomingCommitments = [{
    id: "future",
    title: "Escola",
    categoryName: "Educação",
    dueDate: "2026-08-10",
    amountCents: 121_000,
    recurrenceType: "recurring",
    paymentMethod: "boleto",
    status: "projected",
  }];
  const dashboard = selectPersonFinancialDashboard({
    data,
    period: resolvePersonDashboardPeriod("this_month", "2026-07"),
    referenceMonth: "2026-07",
  });
  assert.equal(dashboard.summary.currentMonthSpent, 173_500);
  assert.equal(dashboard.summary.upcomingCommitmentsAmount, 121_000);
  assert.equal(dashboard.upcomingCommitments.length, 1);
});

test("seção compartilhada fica oculta em zero e visível com reembolso", () => {
  const hidden = selectPersonFinancialDashboard({
    data: dashboardData(),
    period: resolvePersonDashboardPeriod("this_month", "2026-07"),
    referenceMonth: "2026-07",
  });
  assert.equal(hidden.reimbursementSummary.visible, false);
  const data = dashboardData();
  data.allocations = [
    {
      id: "benefit",
      date: "2026-07-10",
      role: "beneficiary",
      allocatedAmountCents: 30_000,
      reimbursableAmountCents: 0,
      reimbursedAmountCents: 0,
      pendingAmountCents: 0,
      status: "active",
    },
    {
      id: "shared",
      date: "2026-07-10",
      role: "shared_responsibility",
      allocatedAmountCents: 15_000,
      reimbursableAmountCents: 15_000,
      reimbursedAmountCents: 15_000,
      pendingAmountCents: 0,
      status: "fully_reimbursed",
    },
  ];
  const visible = selectPersonFinancialDashboard({
    data,
    period: resolvePersonDashboardPeriod("this_month", "2026-07"),
    referenceMonth: "2026-07",
  });
  assert.equal(visible.reimbursementSummary.visible, true);
  assert.equal(visible.reimbursementSummary.userResponsibility, 15_000);
  assert.equal(visible.reimbursementSummary.netCost, 15_000);
});

test("consulta valida workspace e usa tabelas protegidas por RLS", () => {
  const query = readFileSync(
    join(process.cwd(), "src/modules/finance/person-financial-dashboard-query.ts"),
    "utf8",
  );
  assert.match(query, /\.eq\("workspace_id", input\.workspaceId\)/);
  for (const table of [
    "financial_people",
    "transaction_people",
    "commitment_people",
    "expense_allocations",
    "financial_reimbursements",
    "person_counterparties",
  ]) {
    assert.match(query, new RegExp(`from\\("${table}"\\)`));
  }
});

test("cache cobre dashboard, movimentações, reembolsos e Pix", () => {
  const cache = readFileSync(
    join(process.cwd(), "src/modules/finance/commitments-cache.ts"),
    "utf8",
  );
  for (const tag of [
    "finance:person:dashboard:",
    "finance:movements:",
    "finance:reimbursements:",
    "finance:pix:",
  ]) assert.match(cache, new RegExp(tag));
});
