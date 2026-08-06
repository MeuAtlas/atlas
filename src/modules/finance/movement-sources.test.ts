import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { getMovementsData, resolveMovementSourceResults } from "./queries";

const bankMovement = {
  id: "bank-1",
  description: "Salário",
  amount: 5000,
  competence_date: "2026-07-10",
};

const result = (
  data: unknown[] = [],
  error: unknown = null,
) => ({ data, error });

const base = () => ({
  accounts: result([{ id: "account-1", name: "Conta" }]),
  transactions: result([bankMovement]),
  cardPurchases: result([{ id: "card-1", description: "Compra" }]),
  cards: result([{ id: "credit-1", name: "Cartão" }]),
  categories: result([{ id: "category-1", name: "Outros" }]),
  connections: result([{ id: "connection-1" }]),
});

function withoutConsole<T>(run: () => T) {
  const original = console.error;
  console.error = () => undefined;
  try {
    return run();
  } finally {
    console.error = original;
  }
}

test("fontes bancária e de cartão completas são preservadas", () => {
  const data = resolveMovementSourceResults(base());
  assert.equal(data.completeness, "complete");
  assert.equal(data.transactions.length, 1);
  assert.equal(data.cardPurchases.length, 1);
  assert.deepEqual(data.warnings, []);
  assert.deepEqual(data.unavailableSources, []);
});

test("falha de cartão mantém movimentos bancários e retorna aviso parcial", () => {
  const input = base();
  input.cardPurchases = result([], {
    code: "PGRST200",
    message: "Could not find a relationship",
    details: "invalid foreign key hint",
    hint: null,
  });
  const data = withoutConsole(() => resolveMovementSourceResults(input));
  assert.equal(data.completeness, "partial");
  assert.equal(data.transactions[0].id, "bank-1");
  assert.deepEqual(data.cardPurchases, []);
  assert.deepEqual(data.unavailableSources, ["card_purchases"]);
  assert.deepEqual(data.warnings, [{
    source: "card_purchases",
    message: "Compras de cartão temporariamente indisponíveis.",
    code: "PGRST200",
  }]);
});

test("falha bancária continua fatal mesmo quando cartões funcionam", () => {
  const input = base();
  input.transactions = result([], {
    code: "42501",
    message: "permission denied",
  });
  assert.throws(
    () => withoutConsole(() => resolveMovementSourceResults(input)),
    /Não foi possível carregar as movimentações bancárias/,
  );
});

for (const [code, message] of [
  ["42P01", "relation card_purchases does not exist"],
  ["PGRST204", "column not found in schema cache"],
  ["PGRST205", "table not found in schema cache"],
  ["42501", "permission denied for table card_purchases"],
  ["PGRST201", "ambiguous relationship"],
] as const) {
  test(`erro opcional ${code} não derruba a página`, () => {
    const input = base();
    input.cardPurchases = result([], { code, message });
    const data = withoutConsole(() => resolveMovementSourceResults(input));
    assert.equal(data.completeness, "partial");
    assert.equal(data.transactions.length, 1);
    assert.equal(data.cardPurchases.length, 0);
    assert.equal(data.warnings[0].code, code);
  });
}

test("consulta usa colunas e relações reais de card_purchases", () => {
  const source = readFileSync("src/modules/finance/queries.ts", "utf8");
  const start = source.indexOf("export async function getMovementsData");
  const end = source.indexOf("export async function getFinanceData", start);
  const query = source.slice(start, end);
  assert.match(query, /installment_count/);
  assert.doesNotMatch(query, /\.from\("card_installment_occurrences"\)/);
  assert.match(query, /\.eq\("source", "pluggy"\)/);
  assert.match(query, /card_purchases_instrument_id_fkey/);
  assert.doesNotMatch(query, /card_purchases_card_instrument_id_fkey/);
  assert.match(query, /Promise\.allSettled/);
  assert.match(query, /if \(isCardScope && \(isPdfCycle \|\| isClosedWithoutPdf\)\) return emptyResult/);
  assert.match(query, /\.gte\("competence_date", period\.from\)/);
});

test("interface mantém lista, aviso parcial e retry", () => {
  const source = readFileSync(
    "src/components/finance/movements-browser.tsx",
    "utf8",
  );
  assert.match(source, /As movimentações bancárias continuam disponíveis/);
  assert.match(source, /O resumo considera/);
  assert.match(source, /router\.refresh\(\)/);
  assert.match(source, /Ver cartões/);
  assert.match(source, /movement-list-compact/);
});

test("fatura fechada sem PDF orienta o envio no lugar das movimentações", () => {
  const source = readFileSync(
    "src/components/finance/movements-browser.tsx",
    "utf8",
  );
  assert.match(source, /Envie o PDF para gerar as movimentações desta fatura/);
  assert.match(source, /valor total oficial da Pluggy continua sendo exibido/);
  assert.match(
    source,
    /A Pluggy ainda não enviou o valor oficial de fechamento desta fatura/,
  );
  assert.match(
    source,
    /importar-fatura\?statement=\$\{selectedCycle\.cycleId\}/,
  );
});

test("integração: getMovementsData resolve banco e degrada cartão sem lançar", async () => {
  const tableResults: Record<string, { data: unknown[]; error: unknown }> = {
    financial_accounts: result([{ id: "account-1", name: "Conta" }]),
    financial_transactions: result([bankMovement]),
    card_purchases: result([], {
      code: "PGRST200",
      message: "Could not find a relationship",
    }),
    credit_cards: result([]),
    financial_categories: result([]),
    bank_connections: result([]),
  };
  const supabase = {
    from(table: string) {
      const resolved = Promise.resolve(tableResults[table]);
      const builder: Record<string, unknown> = new Proxy({}, {
        get(_target, property) {
          if (property === "then") return resolved.then.bind(resolved);
          return () => builder;
        },
      });
      return builder;
    },
  };
  const original = console.error;
  console.error = () => undefined;
  let data;
  try {
    data = await getMovementsData(
      supabase as never,
      "user-1",
      { from: "2026-07-01", to: "2026-07-31" },
    );
  } finally {
    console.error = original;
  }
  assert.equal(data.completeness, "partial");
  assert.equal(data.transactions.length, 1);
  assert.deepEqual(data.cardPurchases, []);
  assert.equal(data.warnings[0].code, "PGRST200");
});

test("integração: ciclo aberto usa somente compras atuais da Pluggy", async () => {
  const calls: Array<{ table: string; method: string; args: unknown[] }> = [];
  const openCycle = {
    id: "cycle-open",
    card_id: "card-account",
    reference_month: "2026-08-01",
    cycle_start_date: "2026-07-04",
    cycle_end_date: "2026-08-03",
    due_date: "2026-08-10",
    status: "open",
    source: "calculated",
    document_id: null,
  };
  const tableResults: Record<string, { data: unknown; error: unknown }> = {
    card_invoices: { data: openCycle, error: null },
    financial_accounts: result([]),
    financial_transactions: result([
      {
        id: "transaction-duplicate",
        external_id: "provider-open",
        description: "Compra de julho",
        amount: 250,
        transaction_type: "expense",
        transaction_role: "consumption",
        cash_flow_kind: "consumption",
        bank_direction: "outflow",
        competence_date: "2026-07-20",
        status: "realized",
        source: "pluggy",
        credit_card_id: "card-account",
      },
      {
        id: "transaction-only",
        external_id: "provider-only",
        description: "Compra disponível somente no extrato Pluggy",
        amount: 35,
        transaction_type: "expense",
        transaction_role: "consumption",
        cash_flow_kind: "consumption",
        bank_direction: "outflow",
        competence_date: "2026-07-21",
        status: "realized",
        source: "pluggy",
        credit_card_id: "card-account",
      },
      {
        id: "invoice-payment",
        external_id: "provider-payment",
        description: "Pagamento de fatura",
        amount: 11517.22,
        transaction_type: "expense",
        transaction_role: "invoice_payment",
        cash_flow_kind: "invoice_payment",
        bank_direction: "outflow",
        competence_date: "2026-07-04",
        status: "realized",
        source: "pluggy",
        credit_card_id: "card-account",
      },
      {
        id: "manual-transaction",
        external_id: "manual-only",
        description: "Ajuste manual que não pertence à projeção",
        amount: 999,
        transaction_type: "expense",
        transaction_role: "consumption",
        cash_flow_kind: "consumption",
        bank_direction: "outflow",
        competence_date: "2026-07-22",
        status: "realized",
        source: "manual",
        credit_card_id: "card-account",
      },
    ]),
    card_purchases: result([{
      id: "pluggy-open",
      card_id: "card-account",
      instrument_id: "instrument-main",
      external_id: "provider-open",
      invoice_id: "wrong-legacy-cycle",
      description: "Compra de julho",
      total_amount: 250,
      installment_amount: 250,
      installment_number: 1,
      installment_count: 1,
      purchase_date: "2026-07-20",
      competence_date: "2026-07-01",
      source: "pluggy",
      source_type: "card",
      financial_origin: "credit_card",
      transaction_role: "consumption",
      status: "realized",
      review_status: "reviewed",
      provider_category: null,
      merchant: "COMPRA JULHO",
      category_id: null,
      credit_cards: { name: "Cartão", institution_name: "Banco", last_four_digits: "5718" },
      credit_card_instruments: { display_name: "Principal", last_four_digits: "5718", card_kind: "physical" },
    }, {
      id: "pluggy-mastercard-open",
      card_id: "mastercard-account",
      instrument_id: "instrument-mastercard",
      external_id: "provider-mastercard-open",
      invoice_id: null,
      description: "Compra Mastercard",
      total_amount: 50,
      installment_amount: 50,
      installment_number: 1,
      installment_count: 1,
      purchase_date: "2026-07-22",
      competence_date: "2026-07-22",
      source: "pluggy",
      source_type: "card",
      financial_origin: "credit_card",
      transaction_role: "consumption",
      status: "realized",
      review_status: "reviewed",
      provider_category: null,
      merchant: "COMPRA MASTERCARD",
      category_id: null,
      credit_cards: { name: "Mastercard", institution_name: "Banco", last_four_digits: "5718" },
      credit_card_instruments: { display_name: "Mastercard", last_four_digits: "5718", card_kind: "physical" },
    }, {
      id: "pdf-open-legacy",
      card_id: "card-account",
      external_id: "pdf-legacy",
      invoice_id: "cycle-open",
      description: "Parcela vinda de PDF antigo",
      total_amount: 75.15,
      installment_amount: 75.15,
      installment_number: 12,
      installment_count: 13,
      purchase_date: "2026-07-20",
      competence_date: "2026-07-01",
      source: "pdf",
      transaction_role: "consumption",
      status: "realized",
      review_status: "reviewed",
    }]),
    credit_cards: result([{
      id: "card-account",
      name: "Visa",
      bank_connection_id: "connection-1",
      status: "active",
      credit_card_instruments: [{
        id: "instrument-main",
        last_four_digits: "5896",
        display_name: "Visa",
      }],
    }, {
      id: "mastercard-account",
      name: "Mastercard",
      bank_connection_id: "connection-1",
      status: "active",
      credit_card_instruments: [{
        id: "instrument-mastercard",
        last_four_digits: "5718",
        display_name: "Mastercard",
      }],
    }]),
    financial_categories: result([]),
    bank_connections: result([]),
    invoice_entries: result([]),
    card_installment_occurrences: result([{
      id: "occurrence-7",
      card_id: "card-account",
      invoice_entry_id: null,
      competence_month: "2026-08-01",
      installment_number: 7,
      total_installments: 10,
      amount: 100,
      due_date: "2026-08-10",
      card_installment_plans: {
        card_last_four: "6579",
        merchant_normalized: "PARCELA ANTIGA",
        description_reference: "Parcela antiga 07/10",
      },
    }]),
  };
  const supabase = {
    from(table: string) {
      const resolved = Promise.resolve(tableResults[table] ?? result([]));
      const builder: Record<string, unknown> = new Proxy({}, {
        get(_target, property) {
          if (property === "then") return resolved.then.bind(resolved);
          return (...args: unknown[]) => {
            calls.push({ table, method: String(property), args });
            return builder;
          };
        },
      });
      return builder;
    },
  };
  const data = await getMovementsData(
    supabase as never,
    "user-1",
    {
      from: "2026-07-04",
      to: "2026-08-03",
      type: "card",
      cycleId: "cycle-open",
    },
  );
  assert.equal(data.cardPurchases.length, 3);
  assert.deepEqual(
    data.cardPurchases.map(item => item.source).sort(),
    ["pluggy", "pluggy", "pluggy"],
  );
  assert.equal(
    data.cardPurchases.reduce(
      (sum, item) => sum + Number(item.installment_amount),
      0,
    ),
    335,
  );
  assert.ok(data.cardPurchases.every(item => item.description !== "Pagamento de fatura"));
  assert.ok(data.cardPurchases.every(item => item.invoice_id === null));
  assert.ok(data.cardPurchases.every(item => item.source === "pluggy"));
  assert.ok(data.cardPurchases.every(item => item.description !== "Parcela antiga 07/10"));
  assert.ok(!calls.some(call => call.table === "card_installment_occurrences"));
  const cardCalls = calls.filter(call => call.table === "card_purchases");
  assert.ok(cardCalls.some(call =>
    call.method === "in" &&
    call.args[0] === "card_id" &&
    JSON.stringify(call.args[1]) === JSON.stringify([
      "card-account",
      "mastercard-account",
    ])
  ));
  assert.ok(cardCalls.some(call =>
    call.method === "eq" &&
    call.args[0] === "invoice_id" &&
    call.args[1] === "cycle-open"
  ));
  assert.ok(cardCalls.some(call =>
    call.method === "eq" &&
    call.args[0] === "bill_forecast_date" &&
    call.args[1] === "2026-08-01"
  ));
  assert.ok(cardCalls.some(call =>
    call.method === "gte" &&
    call.args[0] === "posting_date" &&
    call.args[1] === "2026-07-04"
  ));
  assert.ok(cardCalls.some(call =>
    call.method === "gte" &&
    call.args[0] === "purchase_date" &&
    call.args[1] === "2026-07-02"
  ));
  assert.ok(cardCalls.some(call =>
    call.method === "gte" &&
    call.args[0] === "competence_date" &&
    call.args[1] === "2026-07-04"
  ));
});
