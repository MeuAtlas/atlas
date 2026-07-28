import assert from "node:assert/strict";
import test from "node:test";
import {
  defaultCardCycle,
  normalizeAvailableCardCycles,
  resolveLegacyCardCycle,
  type CardCycleRow,
} from "./card-cycles";

function row(patch: Partial<CardCycleRow> = {}): CardCycleRow {
  return {
    id: "bill-calculated",
    card_id: "card-a",
    reference_month: "2026-08-01",
    cycle_start_date: "2026-06-26",
    cycle_end_date: "2026-07-25",
    closing_date: "2026-07-25",
    due_date: "2026-08-02",
    status: "open",
    source: "calculated",
    document_id: null,
    provider_bill_id: null,
    official_total: null,
    total_amount: 1200,
    reconciliation_difference: null,
    credit_cards: {
      name: "Atlas Black",
      institution_name: "Banco Atlas",
      last_four_digits: "1234",
    },
    ...patch,
  };
}

test("prioriza ciclo confirmado por PDF sobre Pluggy e cálculo no mesmo intervalo", () => {
  const cycles = normalizeAvailableCardCycles([
    row(),
    row({
      id: "bill-pluggy",
      source: "pluggy_bill",
      provider_bill_id: "provider-1",
      total_amount: 1210,
    }),
    row({
      id: "bill-pdf",
      source: "pdf",
      document_id: "document-1",
      official_total: 1215,
      reconciliation_difference: 5,
    }),
  ], "2026-07-20");
  assert.equal(cycles.length, 1);
  assert.equal(cycles[0].billId, "bill-pdf");
  assert.equal(cycles[0].source, "pdf");
  assert.equal(cycles[0].officialTotal, 1215);
  assert.equal(cycles[0].isCurrent, true);
  assert.equal(cycles[0].label, "Atual");
});

test("seleciona ciclo atual por padrão e resolve URL legada pelo mês de vencimento", () => {
  const cycles = normalizeAvailableCardCycles([
    row({
      id: "bill-july",
      reference_month: "2026-07-01",
      cycle_start_date: "2026-05-26",
      cycle_end_date: "2026-06-25",
      due_date: "2026-07-02",
      status: "paid",
    }),
    row({ id: "bill-august" }),
  ], "2026-07-20");
  assert.equal(defaultCardCycle(cycles)?.cycleId, "bill-august");
  assert.equal(defaultCardCycle(cycles)?.billId, null);
  assert.equal(resolveLegacyCardCycle(cycles, "2026-07")?.cycleId, "bill-july");
});

test("ignora faturas sem intervalo persistido em vez de inventar um ciclo", () => {
  assert.deepEqual(
    normalizeAvailableCardCycles([
      row({ cycle_start_date: null, cycle_end_date: null }),
    ]),
    [],
  );
});
