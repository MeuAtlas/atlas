import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  buildMovementFiltersUrl,
  buildMovementQueryKey,
  canonicalizeMovementPath,
  calculateFinancialAnalysis,
  calculateMovementBankAccountCashFlow,
  calculateMovementPeriodSummary,
  calculateMovementSummaryByFilter,
  deduplicateMovements,
  groupMovementsByDate,
  currentMovementFiltersPath,
  legacyTabType,
  matchesMovement,
  movementKind,
  normalizeCardPurchase,
  normalizeFinancialTransaction,
  normalizeMovementFilterState,
  navigateIfChanged,
  serializeMovementFilters,
} from "./movement-filters";
import type { AvailableCardCycle } from "./card-cycles";
import type { CardPurchase, FinancialAccount, FinancialTransaction } from "./types";

const account: FinancialAccount = {
  id: "account-a",
  name: "Conta principal",
  institution_name: "Banco Exemplo",
  account_type: "checking",
  current_balance: 0,
  opening_balance: 0,
  source: "pluggy",
  status: "active",
  visibility: "private",
  last_sync_at: null,
};

const transaction = (
  patch: Partial<FinancialTransaction> = {},
): FinancialTransaction => ({
  id: "bank",
  description: "Movimentação",
  amount: 20,
  transaction_type: "expense",
  transaction_role: "cash_flow",
  source_type: "bank",
  financial_origin: "bank_account",
  financial_role: "expense",
  status: "realized",
  competence_date: "2026-07-20",
  due_date: null,
  realized_at: "2026-07-20T12:00:00Z",
  source: "pluggy",
  visibility: "private",
  account_id: account.id,
  destination_account_id: null,
  category_id: null,
  workspace_id: null,
  review_status: "reviewed",
  ...patch,
});

const purchase = (
  patch: Partial<CardPurchase> = {},
): CardPurchase => ({
  id: "purchase",
  card_id: "card-a",
  invoice_id: null,
  description: "Compra",
  total_amount: 100,
  installment_amount: 10,
  purchase_date: "2026-07-21",
  installment_number: null,
  installment_count: null,
  source: "pluggy",
  source_type: "card",
  financial_origin: "credit_card",
  transaction_role: "consumption",
  status: "realized",
  review_status: "reviewed",
  invoice_reference: null,
  bill_forecast_date: null,
  provider_category: null,
  merchant: null,
  visibility: "private",
  category_id: null,
  ...patch,
});

test("resumo calcula entradas, saídas e resultado", () => {
  const items = [
    normalizeFinancialTransaction(transaction({
      id: "income", transaction_type: "income", bank_direction: "inflow", amount: 150,
      financial_role: "revenue",
    }), [account]),
    normalizeFinancialTransaction(transaction({
      id: "expense", bank_direction: "outflow", amount: 40,
    }), [account]),
  ];
  assert.deepEqual(calculateMovementPeriodSummary(items), {
    totalInflows: 150,
    totalOutflows: 40,
    result: 110,
    transferVolume: 0,
    movementCount: 2,
    reviewPendingCount: 0,
  });
});

test("compra internacional usa BRL no total e aceita busca nas duas moedas", () => {
  const item = normalizeCardPurchase(purchase({
    description: "Github, Inc.",
    installment_amount: 65.62,
    amount_brl: 65.62,
    original_amount: 12.2,
    original_currency_code: "USD",
    conversion_source: "pluggy",
  }));
  assert.equal(item.amount, 65.62);
  assert.equal(item.originalAmount, 12.2);
  assert.equal(item.originalCurrencyCode, "USD");
  assert.ok(matchesMovement(item, { type: "card", search: "12,20" }));
  assert.ok(matchesMovement(item, { type: "card", search: "65,62" }));
  assert.ok(matchesMovement(item, { type: "card", search: "USD" }));
  assert.ok(matchesMovement(item, { type: "card", search: "US$" }));
});

test("transferência própria não entra no resultado", () => {
  const item = normalizeFinancialTransaction(transaction({
    transaction_type: "transfer",
    transaction_role: "transfer",
    financial_role: "transfer",
    transfer_group_id: "group",
    destination_account_id: "account-b",
    amount: 500,
  }), [account]);
  const summary = calculateMovementPeriodSummary([item]);
  assert.equal(item.isOwnTransfer, true);
  assert.equal(item.origin, "transfer");
  assert.equal(matchesMovement(item, {
    period: "custom", from: "2026-07-01", to: "2026-07-31", type: "transfer",
  }), true);
  assert.equal(matchesMovement(item, {
    period: "custom", from: "2026-07-01", to: "2026-07-31", type: "bank",
  }), true);
  assert.equal(summary.result, 0);
  assert.equal(summary.transferVolume, 500);
});

test("pagamento de fatura é saída de caixa sem duplicar consumo", () => {
  const item = normalizeFinancialTransaction(transaction({
    transaction_role: "invoice_payment",
    financial_nature: "invoice_payment",
    bank_direction: "outflow",
    amount: 800,
  }), [account]);
  assert.equal(item.description, "Pagamento de fatura");
  assert.equal(item.displayType, "Saída da conta");
  assert.equal(item.categoryName, "Pagamento de cartão");
  assert.equal(item.accountCashFlowEffect, "outflow");
  assert.equal(item.summaryEffect, "none");
  assert.equal(item.consolidatedFinancialEffect, "none");
  assert.equal(item.consumptionEffect, "neutral");
  assert.equal(calculateMovementBankAccountCashFlow([item]).totalOutflows, 800);
  assert.equal(calculateFinancialAnalysis([item]).totalOutflows, 0);
});

test("caso real separa fluxo bancário de análise consolidada sem erro decimal", () => {
  const items = [
    normalizeFinancialTransaction(transaction({
      id: "total-income",
      amount: 48_923.92,
      transaction_type: "income",
      financial_role: "revenue",
      bank_direction: "inflow",
    }), [account]),
    normalizeFinancialTransaction(transaction({
      id: "ordinary-debits",
      amount: 42_928.10,
      bank_direction: "outflow",
    }), [account]),
    normalizeFinancialTransaction(transaction({
      id: "invoice-payment",
      description: "PAGAMENTO CARTAO",
      amount: 11_517.22,
      transaction_role: "invoice_payment",
      financial_nature: "invoice_payment",
      cash_flow_kind: "invoice_payment",
      bank_direction: "outflow",
      credit_card_id: "card-a",
      invoice_id: "invoice-a",
    }), [account]),
    normalizeCardPurchase(purchase({
      id: "card-consumption",
      installment_amount: 11_517.22,
    })),
  ];
  const bankItems = items.filter(item => matchesMovement(item, {
    period: "custom",
    from: "2026-07-01",
    to: "2026-07-31",
    type: "bank",
  }));
  const bank = calculateMovementBankAccountCashFlow(bankItems);
  const analysis = calculateFinancialAnalysis(items);

  assert.equal(bankItems.some(item => item.isInvoicePayment), true);
  assert.equal(bank.totalInflows, 48_923.92);
  assert.equal(bank.totalOutflows, 54_445.32);
  assert.equal(bank.netMovement, -5_521.40);
  assert.equal(bank.largestOutflow, 42_928.10);
  assert.deepEqual(
    calculateMovementSummaryByFilter(bankItems, "bank").cards.map(card => card.value),
    [48_923.92, 54_445.32, -5_521.40],
  );
  assert.equal(analysis.totalOutflows, 42_928.10);
  assert.equal(
    items.filter(item => matchesMovement(item, {
      period: "custom",
      from: "2026-07-01",
      to: "2026-07-31",
      type: "card",
    })).some(item => item.isInvoicePayment),
    false,
  );
});

test("aplicação e resgate não viram despesa ou receita", () => {
  const application = normalizeFinancialTransaction(transaction({
    id: "application",
    financial_nature: "investment_application",
    bank_direction: "outflow",
    amount: 300,
  }), [account]);
  const redemption = normalizeFinancialTransaction(transaction({
    id: "redemption",
    transaction_type: "income",
    financial_nature: "investment_redemption",
    bank_direction: "inflow",
    amount: 200,
  }), [account]);
  const summary = calculateMovementPeriodSummary([application, redemption]);
  assert.equal(summary.totalInflows, 0);
  assert.equal(summary.totalOutflows, 0);
});

test("rendimento vira entrada e salário usa categoria interna", () => {
  const income = normalizeFinancialTransaction(transaction({
    transaction_type: "income",
    bank_direction: "inflow",
    financial_role: "revenue",
    financial_nature: "investment_income",
  }), [account]);
  const salary = normalizeFinancialTransaction(transaction({
    transaction_type: "income",
    bank_direction: "inflow",
    financial_role: "revenue",
    financial_nature: "salary",
  }), [account]);
  assert.equal(income.categoryName, "Rendimentos");
  assert.equal(income.summaryEffect, "inflow");
  assert.equal(salary.categoryName, "Salário");
  assert.equal(salary.description, "Crédito de salário");
});

test("categoria manual tem prioridade e Pluggy funciona como fallback", () => {
  const manual = normalizeFinancialTransaction(transaction({
    financial_nature: "salary",
    manually_confirmed: true,
    financial_categories: { name: "Categoria corrigida" },
  }), [account]);
  const provider = normalizeCardPurchase(purchase({ provider_category: "Restaurantes" }));
  assert.equal(manual.categoryName, "Categoria corrigida");
  assert.equal(provider.categoryName, "Restaurantes");
});

test("filtros cobrem busca, período, conta e tipo", () => {
  const item = normalizeFinancialTransaction(transaction({
    description: "Crédito especial",
    transaction_type: "income",
    bank_direction: "inflow",
    financial_role: "revenue",
  }), [account]);
  const base = { period: "custom", from: "2026-07-01", to: "2026-07-31" };
  assert.equal(matchesMovement(item, { ...base, search: "banco exemplo" }), true);
  assert.equal(matchesMovement(item, { ...base, search: "inexistente" }), false);
  assert.equal(matchesMovement(item, { ...base, account: account.id }), true);
  assert.equal(matchesMovement(item, { ...base, account: "other" }), false);
  assert.equal(matchesMovement(item, { ...base, type: "bank" }), true);
  assert.equal(matchesMovement(item, { ...base, type: "card" }), false);
});

test("transação estrutural de cartão não vira saída bancária nem dado incompleto", () => {
  const item = normalizeFinancialTransaction(transaction({
    id: "card-transaction",
    description: "ELSHADAY 01/02",
    amount: 76,
    account_id: null,
    credit_card_id: "card-a",
    source_type: "card",
    financial_origin: "credit_card",
    transaction_role: "consumption",
    bank_direction: "outflow",
    provider_category: "Restaurantes",
    credit_cards: {
      name: "Santander Unlimited",
      last_four_digits: "6579",
    },
  }), [account]);
  const base = { period: "custom", from: "2026-07-01", to: "2026-07-31" };

  assert.equal(item.origin, "credit_card");
  assert.equal(item.movementType, "card");
  assert.equal(item.displayType, "Compra no cartão");
  assert.equal(item.cardLabel, "Santander Unlimited");
  assert.equal(item.accountName, "Santander Unlimited");
  assert.equal(item.accountMaskedIdentifier, "final 6579");
  assert.equal(item.categoryName, "Restaurantes");
  assert.equal(item.cashFlowEffect, "neutral");
  assert.equal(item.accountCashFlowEffect, "neutral");
  assert.equal(item.consumptionEffect, "expense");
  assert.equal(item.summaryEffect, "none");
  assert.equal(item.dataCompleteness, "complete");
  assert.equal(matchesMovement(item, { ...base, type: "all" }), true);
  assert.equal(matchesMovement(item, { ...base, type: "card" }), true);
  assert.equal(matchesMovement(item, { ...base, type: "bank" }), false);
});

test("filtros avançados cobrem revisão, categoria, origem e ignoradas", () => {
  const item = normalizeFinancialTransaction(transaction({
    category_id: "category-a",
    review_status: "pending",
    status: "cancelled",
  }), [account]);
  const base = { period: "custom", from: "2026-07-01", to: "2026-07-31" };
  assert.equal(matchesMovement(item, { ...base, review: "pending" }), true);
  assert.equal(matchesMovement(item, { ...base, category: "category-a" }), true);
  assert.equal(matchesMovement(item, { ...base, origin: "pluggy" }), true);
  assert.equal(matchesMovement(item, { ...base, ignored: "true" }), true);
});

test("URLs antigas são mapeadas para o filtro único", () => {
  assert.equal(legacyTabType("bank"), "bank");
  assert.equal(legacyTabType("cards"), "card");
  assert.equal(legacyTabType("transfers"), "transfer");
  assert.equal(legacyTabType("adjustments"), "adjustment");
});

test("URL canônica preserva o filtro e limpa paginação e parâmetros obsoletos", () => {
  assert.equal(
    buildMovementFiltersUrl({
      type: "card",
      period: "this-month",
      page: "4",
      tab: "cards",
      q: "mercado",
    }),
    "/financeiro/movimentacoes?type=card&search=mercado",
  );
  assert.equal(
    buildMovementFiltersUrl(
      { type: "card", period: "this-month", page: "4" },
      { type: "all" },
    ),
    "/financeiro/movimentacoes?type=all&period=this-month",
  );
  assert.equal(
    buildMovementFiltersUrl(
      { type: "all", period: "this-month" },
      { type: "card" },
    ),
    "/financeiro/movimentacoes?type=card",
  );
});

test("serialização da URL é determinística e page=1 não alterna a rota", () => {
  const first = serializeMovementFilters({
    search: "mercado",
    cycle: "cycle-a",
    type: "card",
    page: "1",
  });
  const second = serializeMovementFilters({
    page: "1",
    type: "card",
    cycle: "cycle-a",
    search: "mercado",
  });
  assert.equal(first, "type=card&cycle=cycle-a&search=mercado");
  assert.equal(second, first);
  assert.equal(
    canonicalizeMovementPath(
      "/financeiro/movimentacoes?cycle=cycle-a&type=card&page=1",
    ),
    canonicalizeMovementPath(
      "/financeiro/movimentacoes?type=card&cycle=cycle-a",
    ),
  );
});

test("URL canônica existente não navega e URL antiga navega uma única vez", () => {
  const calls: string[] = [];
  const router = {
    push: (href: string) => calls.push(`push:${href}`),
    replace: (href: string) => calls.push(`replace:${href}`),
  };
  const canonical =
    "/financeiro/movimentacoes?type=card&cycle=0219faee-6359-4071-ac45-8a0fa3423764";
  assert.equal(navigateIfChanged(router, canonical, canonical), false);
  assert.deepEqual(calls, []);

  const legacy =
    "/financeiro/movimentacoes?tab=cards&bill=0219faee-6359-4071-ac45-8a0fa3423764";
  assert.equal(navigateIfChanged(router, legacy, canonical), true);
  assert.deepEqual(calls, [`replace:${canonical}`]);
});

const currentCycle: AvailableCardCycle = {
  cycleId: "cycle-current",
  billId: "bill-current",
  referenceMonth: "2026-07-01",
  kind: "open",
  label: "Atual",
  compactLabel: "Atual — 26/06 a 25/07",
  cycleStartDate: "2026-06-26",
  cycleEndDate: "2026-07-25",
  closingDate: "2026-07-25",
  dueDate: "2026-08-02",
  status: "open",
  source: "pdf",
  cardAccountId: "card-a",
  cardId: "card-a",
  cardIds: ["card-a"],
  cardLabel: "Atlas · final 1234",
  providerBillId: null,
  officialTotal: 1250,
  reconciliationDifference: 0,
  identifiedEntriesTotal: 1250,
  creditsTotal: 0,
  paymentsTotal: 0,
  financeChargesTotal: 0,
  previousBalance: 0,
  lastReliableTotal: 1250,
  dataCompleteness: "complete",
  isCurrent: true,
};

test("normalização no servidor distingue URL direta, legado e ciclo default", () => {
  const direct = {
    type: "card",
    cycle: "0219faee-6359-4071-ac45-8a0fa3423764",
  };
  assert.equal(
    canonicalizeMovementPath(currentMovementFiltersPath(direct)),
    canonicalizeMovementPath(buildMovementFiltersUrl(direct, {}, {
      preservePage: true,
    })),
  );

  const legacy = { tab: "cards", bill: "bill-current" };
  const normalizedLegacy = normalizeMovementFilterState(legacy, [currentCycle]);
  assert.notEqual(
    canonicalizeMovementPath(currentMovementFiltersPath(legacy)),
    canonicalizeMovementPath(buildMovementFiltersUrl(normalizedLegacy, {}, {
      preservePage: true,
    })),
  );

  const withoutCycle = { type: "card" };
  const normalizedDefault = normalizeMovementFilterState(
    withoutCycle,
    [currentCycle],
  );
  assert.notEqual(
    canonicalizeMovementPath(currentMovementFiltersPath(withoutCycle)),
    canonicalizeMovementPath(buildMovementFiltersUrl(normalizedDefault, {}, {
      preservePage: true,
    })),
  );
});

test("cartão usa bill canônico e banco usa período sem misturar os dois contratos", () => {
  assert.equal(
    normalizeMovementFilterState({
      type: "card",
      card: "all",
    }, [currentCycle]).card,
    undefined,
  );
  assert.deepEqual(
    normalizeMovementFilterState({
      type: "card",
      period: "last-month",
      from: "2026-06-01",
      to: "2026-06-30",
      account: "account-a",
    }, [currentCycle]),
    {
      type: "card",
      period: undefined,
      from: undefined,
      to: undefined,
      account: undefined,
      cycle: "cycle-current",
      bill: undefined,
      search: undefined,
      q: undefined,
      tab: undefined,
      cursor: undefined,
      offset: undefined,
    },
  );
  assert.equal(
    buildMovementFiltersUrl({
      type: "card",
      bill: "bill-current",
      period: "last-month",
      page: "3",
      cursor: "next",
    }),
    "/financeiro/movimentacoes?type=card&bill=bill-current",
  );
  assert.equal(
    buildMovementFiltersUrl({
      type: "bank",
      bill: "bill-current",
      cycle: "2026-08",
      period: "last-month",
    }),
    "/financeiro/movimentacoes?type=bank&period=last-month",
  );
});

test("troca de fatura altera a query e compra vinculada permanece no ciclo correto", () => {
  const previousCycle = {
    ...currentCycle,
    cycleId: "cycle-previous",
    billId: "bill-previous",
    label: "Julho de 2026",
    compactLabel: "Julho de 2026 — 26/05 a 25/06",
    cycleStartDate: "2026-05-26",
    cycleEndDate: "2026-06-25",
    dueDate: "2026-07-02",
    isCurrent: false,
  };
  assert.notEqual(
    buildMovementQueryKey({ type: "card", cycle: currentCycle.cycleId }),
    buildMovementQueryKey({ type: "card", cycle: previousCycle.cycleId }),
  );
  const installment = normalizeCardPurchase(purchase({
    invoice_id: "bill-current",
    purchase_date: "2026-05-10",
  }));
  assert.equal(
    matchesMovement(
      installment,
      { type: "card", cycle: currentCycle.cycleId },
      currentCycle,
    ),
    true,
  );
  assert.equal(
    matchesMovement(
      installment,
      { type: "card", cycle: previousCycle.cycleId },
      previousCycle,
    ),
    false,
  );
});

test("integração separa mês bancário de duas faturas e preserva cartão dentro do bill", () => {
  const augustCycle: AvailableCardCycle = {
    ...currentCycle,
    cycleId: "cycle-august",
    billId: "bill-august",
    cycleStartDate: "2026-07-04",
    cycleEndDate: "2026-08-03",
    closingDate: "2026-08-03",
    dueDate: "2026-08-10",
    cardIds: ["card-a", "card-b"],
  };
  const julyCycle: AvailableCardCycle = {
    ...currentCycle,
    cycleId: "cycle-july",
    billId: "bill-july",
    label: "Julho de 2026",
    cycleStartDate: "2026-06-03",
    cycleEndDate: "2026-07-03",
    closingDate: "2026-07-03",
    dueDate: "2026-07-10",
    status: "paid",
    isCurrent: false,
  };
  const items = [
    normalizeFinancialTransaction(transaction({
      id: "bank-expense",
      competence_date: "2026-07-08",
      bank_direction: "outflow",
    }), [account]),
    normalizeFinancialTransaction(transaction({
      id: "invoice-payment",
      competence_date: "2026-07-10",
      transaction_role: "invoice_payment",
      financial_nature: "invoice_payment",
      bank_direction: "outflow",
    }), [account]),
    normalizeCardPurchase(purchase({
      id: "august-a",
      invoice_id: "bill-august",
      purchase_date: "2026-07-20",
    })),
    normalizeCardPurchase(purchase({
      id: "august-b",
      card_id: "card-b",
      invoice_id: "bill-august",
      purchase_date: "2026-07-21",
    })),
    normalizeCardPurchase(purchase({
      id: "july",
      invoice_id: "bill-july",
      purchase_date: "2026-06-20",
    })),
    normalizeCardPurchase(purchase({
      id: "old-installment",
      invoice_id: "bill-august",
      purchase_date: "2026-05-01",
      installment_number: 3,
      installment_count: 12,
    })),
  ];
  const bankIds = items
    .filter(item => matchesMovement(item, {
      type: "bank",
      period: "custom",
      from: "2026-07-01",
      to: "2026-07-31",
    }))
    .map(item => item.id);
  const augustIds = items
    .filter(item => matchesMovement(
      item,
      { type: "card", bill: "bill-august" },
      augustCycle,
    ))
    .map(item => item.id);
  const cardBIds = items
    .filter(item => matchesMovement(
      item,
      { type: "card", bill: "bill-august", card: "card-b" },
      augustCycle,
    ))
    .map(item => item.id);

  assert.deepEqual(bankIds, ["bank-expense", "invoice-payment"]);
  assert.deepEqual(augustIds, ["august-a", "august-b", "old-installment"]);
  assert.deepEqual(cardBIds, ["august-b"]);
  assert.equal(
    items.filter(item => matchesMovement(
      item,
      { type: "card", bill: "bill-july" },
      julyCycle,
    )).map(item => item.id).includes("july"),
    true,
  );
});

test("agrupamento por data preserva subtotal diário", () => {
  const items = [
    normalizeFinancialTransaction(transaction({ id: "a", bank_direction: "inflow", transaction_type: "income", financial_role: "revenue", amount: 100 }), [account]),
    normalizeFinancialTransaction(transaction({ id: "b", bank_direction: "outflow", amount: 25 }), [account]),
  ];
  const groups = groupMovementsByDate(items);
  assert.equal(groups["2026-07-20"].length, 2);
  assert.equal(calculateMovementPeriodSummary(groups["2026-07-20"]).result, 75);
});

test("compra de cartão permanece separada da conta bancária", () => {
  assert.equal(movementKind(transaction()), "outflow");
  assert.equal(movementKind(purchase()), "card");
  assert.equal(normalizeCardPurchase(purchase()).summaryEffect, "none");
});

test("resumo de cartões separa compras, estornos e total líquido", () => {
  const expense = normalizeCardPurchase(purchase({ id: "expense", installment_amount: 100 }));
  const refund = normalizeCardPurchase(purchase({
    id: "refund",
    installment_amount: -25,
    transaction_role: "refund",
  }));
  const summary = calculateMovementSummaryByFilter([expense, refund], "card");
  assert.deepEqual(summary.cards.map(card => [card.label, card.value]), [
    ["Compras lançadas", 100],
    ["Parcelas comprometidas", 0],
    ["Projeção atual", 75],
  ]);
});

test("fatura PDF usa total oficial sem substituir pelo somatório híbrido", () => {
  const expense = normalizeCardPurchase(purchase({
    id: "pdf-expense",
    source: "pdf",
    installment_amount: 13_114.97,
  }));
  const summary = calculateMovementSummaryByFilter(
    [expense],
    "card",
    {
      ...currentCycle,
      officialTotal: 11_517.22,
      source: "pdf",
      kind: "closed",
      status: "paid",
      isCurrent: false,
    },
  );
  assert.deepEqual(summary.cards.map(card => [card.label, card.value]), [
    ["Total oficial", 11_517.22],
    ["Compras e encargos", 13_114.97],
    ["Créditos e estornos", 0],
  ]);
});

test("ciclo aberto vazio não mostra zero falso e preserva último total confiável", () => {
  const unavailable = calculateMovementSummaryByFilter([], "card", {
    ...currentCycle,
    source: "calculated",
    kind: "estimated",
    billId: null,
    officialTotal: null,
    lastReliableTotal: null,
  });
  assert.deepEqual(
    unavailable.cards.map(card => card.value),
    [null, null, null],
  );
  const preserved = calculateMovementSummaryByFilter([], "card", {
    ...currentCycle,
    source: "calculated",
    kind: "estimated",
    billId: null,
    officialTotal: null,
    lastReliableTotal: 987.65,
  });
  assert.deepEqual(
    preserved.cards.map(card => card.value),
    [null, null, 987.65],
  );
});

test("fatura fechada sem total oficial não promove projeção antiga", () => {
  const summary = calculateMovementSummaryByFilter([], "card", {
    ...currentCycle,
    source: "calculated",
    kind: "paid",
    status: "paid",
    isCurrent: false,
    officialTotal: null,
    lastReliableTotal: 6_044.53,
  });
  assert.deepEqual(summary.cards.map(card => [card.label, card.value]), [
    ["Total oficial", null],
    ["Compras e encargos", null],
    ["Créditos e estornos", null],
  ]);
});

test("deduplicação mantém uma compra representada nas duas fontes", () => {
  const bankCopy = normalizeFinancialTransaction(transaction({
    id: "legacy-copy",
    description: "LOJA TESTE",
    amount: 49.9,
    account_id: null,
    credit_card_id: "card-a",
    source_type: "card",
    financial_origin: "credit_card",
    transaction_role: "consumption",
  }));
  const cardCopy = normalizeCardPurchase(purchase({
    id: "canonical-copy",
    description: "LOJA TESTE",
    installment_amount: 49.9,
    purchase_date: "2026-07-20",
    competence_date: "2026-07-20",
  }));
  const result = deduplicateMovements([bankCopy, cardCopy]);
  assert.equal(result.length, 1);
  assert.equal(result[0].sourceKind, "card_purchase");
});

test("interface remove abas e cards altos e mantém drawer acessível", () => {
  const source = readFileSync("src/components/finance/movements-browser.tsx", "utf8");
  const page = readFileSync("src/app/financeiro/movimentacoes/page.tsx", "utf8");
  assert.doesNotMatch(page, /movement-tabs|Histórico por origem|Nova movimentação/);
  assert.match(source, /role="dialog" aria-modal="true"/);
  assert.match(source, /event\.key === "Escape"/);
  assert.match(source, /triggerRef\.current\?\.focus/);
  assert.match(source, /type="button"/);
  assert.match(source, /<option value="bank">Conta bancária<\/option>/);
  assert.match(source, /<option value="card">Cartões<\/option>/);
  assert.doesNotMatch(source, /<option value="inflow">/);
  assert.match(source, /navigateIfChanged\(router, currentPath, nextPath\)/);
  assert.match(source, /const navigate = useClientNavigation\(\)/);
  assert.match(source, /aria-pressed=\{active\}/);
  assert.match(source, /filters\.cycle \|\| defaultCardCycleId/);
  assert.match(source, /cycle\.status === "open" \? `\$\{month\} · em aberto` : month/);
  assert.match(source, /cycle\.dueDate \? `vence \$\{dayMonth\(cycle\.dueDate\)\}`/);
  assert.match(source, /<p>Selecione uma fatura\.<\/p>/);
  assert.doesNotMatch(source, /cycle => cycle\.isCurrent \? "Fatura atual"/);
  assert.match(source, /if \(cycle\.kind === "estimated"\) return "Projeção"/);
  assert.doesNotMatch(
    source,
    /value:\s*"all",\s*label:\s*"Todas"/,
  );
  assert.doesNotMatch(page, /key=\{buildMovementQueryKey\(filters\)\}/);
  assert.equal(source.match(/router\.refresh\(\)/g)?.length, 1);
  assert.match(source, /onClick=\{\(\) => router\.refresh\(\)\}/);
  assert.doesNotMatch(source, /setInterval|refetchInterval|polling/);
  assert.match(source, /O dinheiro entrou na conta/);
  assert.match(source, /O dinheiro saiu da conta/);
  assert.doesNotMatch(source, /Pessoa e reembolso|Classificar como reembolso/);
  assert.doesNotMatch(page, /rawFilters\.cycle\s*\|\|/);
  assert.match(
    page,
    /canonicalizeMovementPath\(currentPath\)[\s\S]*canonicalizeMovementPath\(canonicalPath\)/,
  );
});

test("interface possui estados, paginação e privacidade de valores", () => {
  const source = readFileSync("src/components/finance/movements-browser.tsx", "utf8");
  const error = readFileSync("src/app/financeiro/movimentacoes/error.tsx", "utf8");
  assert.match(source, /Nenhuma movimentação encontrada/);
  assert.match(source, /Conecte uma conta para ver suas movimentações/);
  assert.match(source, /Exibindo \{Math\.min\(page \* pageSize/);
  assert.match(source, /<Money/);
  assert.match(source, /Mais filtros/);
  assert.match(error, /Seus dados não foram alterados/);
  assert.match(error, /Tentar novamente/);
});

test("interface preserva as duas moedas sem oferecer cadastro manual", () => {
  const source = readFileSync("src/components/finance/movements-browser.tsx", "utf8");
  const actions = readFileSync("src/modules/finance/actions.ts", "utf8");
  assert.match(source, /formatMoneyByCurrency/);
  assert.match(source, /Valor original/);
  assert.match(source, /Valor convertido/);
  assert.match(source, /movement-row-foreign-original/);
  assert.match(source, /\$\{convertedMoney\} em reais/);
  assert.match(source, /Conversão em reais indisponível/);
  assert.match(source, /movement-drawer-foreign-amount/);
  assert.match(source, /Data da compra/);
  assert.doesNotMatch(source, /Adicionar lançamento/);
  assert.doesNotMatch(source, /addManualCardCycleMovement/);
  assert.match(actions, /amount_brl:amount/);
  assert.match(actions, /original_currency_code:currency==="BRL"\?null:currency/);
  assert.match(actions, /external_id:`\$\{externalId\}:iof`/);
});

test("consulta é limitada ao período e aos campos da lista", () => {
  const source = readFileSync("src/modules/finance/queries.ts", "utf8");
  const restoredInvoicePaymentQueries = source.match(
    /migrated_card_purchase_id\.is\.null,transaction_role\.eq\.invoice_payment,cash_flow_kind\.eq\.invoice_payment/g,
  ) ?? [];
  const start = source.indexOf("export async function getMovementsData");
  const end = source.indexOf("export async function getFinanceData", start);
  const query = source.slice(start, end);
  assert.match(query, /\.gte\("competence_date",\s*period\.from\)/);
  assert.match(query, /\.lte\("competence_date",\s*period\.to\)/);
  assert.match(query, /\.limit\(400\)/);
  assert.match(query, /financial_transactions_credit_card_id_fkey\(name,last_four_digits\)/);
  assert.match(query, /migrated_card_purchase_id\.is\.null,transaction_role\.eq\.invoice_payment/);
  assert.match(query, /transaction\.transaction_role === "invoice_payment"/);
  assert.match(query, /\["forecast", "cancelled"\]\.includes\(transaction\.status\)/);
  assert.match(query, /\.from\("card_invoices"\)[\s\S]*?\.eq\("owner_id",\s*userId\)[\s\S]*?\.eq\("id",\s*scope\.cycleId\)/);
  assert.match(query, /\.from\("invoice_entries"\)[\s\S]*?\.eq\("bill_id",\s*selectedCycle\.id\)[\s\S]*?\.in\("entry_type"/);
  assert.match(query, /eq\("provider_bill_id", selectedCycle\.provider_bill_id\)/);
  assert.match(query, /eq\("bill_forecast_date", selectedCycle\.reference_month\)/);
  assert.match(query, /gte\("posting_date", period\.from\)[\s\S]*lte\("posting_date", period\.to\)/);
  assert.match(query, /gte\("purchase_date", cutoffGraceFrom\)[\s\S]*lte\("purchase_date", period\.to\)/);
  assert.match(query, /eq\("invoice_id", selectedCycle\.id\)/);
  assert.match(query, /new Map<string, unknown>\(\)/);
  assert.match(query, /if \(isCardScope && \(isPdfCycle \|\| isClosedWithoutPdf\)\) return emptyResult/);
  assert.doesNotMatch(query, /\.from\("card_installment_occurrences"\)/);
  assert.match(query, /\.eq\("source", "pluggy"\)/);
  assert.equal(restoredInvoicePaymentQueries.length, 4);
  assert.doesNotMatch(query, /financial_investments|financial_loans/);
});

test("backfill restaura pagamentos migrados e é idempotente", () => {
  const sql = readFileSync(
    "supabase/migrations/202607280035_restore_invoice_payments_to_bank_cash_flow.sql",
    "utf8",
  );
  assert.match(sql, /invoice payment cash-flow dry-run/);
  assert.match(sql, /bank_direction = 'outflow'/);
  assert.match(sql, /migrated_card_purchase_id = null/);
  assert.match(sql, /is distinct from 'outflow'/);
  assert.match(sql, /get diagnostics corrected_count = row_count/);
  assert.doesNotMatch(sql, /delete from public\.card_purchases/);
});

test("layout é compacto, responsivo e sem scroll horizontal", () => {
  const css = readFileSync("src/app/globals.css", "utf8");
  assert.match(css, /\.movement-row\{[\s\S]*min-height:72px/);
  assert.match(
    css,
    /\.movement-drawer-backdrop\{[^}]*align-items:center;justify-content:center/,
  );
  assert.match(css, /\.movement-drawer\{[^}]*width:min\(980px/);
  assert.match(css, /@media\(max-width:640px\)[\s\S]*\.movement-drawer/);
  assert.match(css, /\.movement-row:focus-visible/);
  assert.match(css, /\.finance-scroll\{[^}]*overflow-x:hidden/);
  assert.match(css, /\.movements-page\{[^}]*min-width:0/);
});

test("interface alterna período bancário e fatura real com estado vazio responsivo", () => {
  const source = readFileSync("src/components/finance/movements-browser.tsx", "utf8");
  const css = readFileSync("src/app/globals.css", "utf8");
  assert.match(source, /export function BankPeriodSelect/);
  assert.match(source, /export function CardBillSelect/);
  assert.match(source, /<optgroup label=\{group\}/);
  assert.match(source, /cycleCardLabel/);
  assert.match(source, /Mastercard/);
  assert.match(source, /Todos os cartões desta fatura/);
  assert.match(source, /name="cycle"/);
  assert.match(source, /type === "card" \? \(/);
  assert.match(source, /Nenhuma fatura disponível/);
  assert.match(source, /Confirmada por PDF/);
  assert.match(source, /return "Projeção"/);
  assert.match(source, /Projeção Pluggy/);
  assert.match(source, /Movimentações: somente Pluggy/);
  assert.match(source, /Atualiza após cada sincronização/);
  assert.doesNotMatch(source, /label: "Parcelas projetadas"/);
  assert.match(source, /Diferença/);
  assert.match(css, /\.movement-card-bill/);
  assert.match(css, /@media\(max-width:640px\)[\s\S]*\.movement-card-bill/);
});
