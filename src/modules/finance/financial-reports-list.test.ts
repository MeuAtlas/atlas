import assert from "node:assert/strict";
import test from "node:test";

import {
  getFinancialMonthAction,
  getFinancialMonthDisplayState,
  getStatementForCashMonth,
  selectActiveFinancialMonths,
  selectClosedFinancialMonths,
} from "./financial-reports-list";
import type { FinancialMonthRecord } from "./monthly-financial-report-query";
import type { MonthlyStatement } from "./monthly-financial-report";

const month = (year: number, value: number, status: FinancialMonthRecord["status"]): FinancialMonthRecord => ({
  id: `${year}-${value}`,
  workspace_id: "workspace",
  reference_year: year,
  reference_month: value,
  period_start: `${year}-${String(value).padStart(2, "0")}-01T03:00:00.000Z`,
  period_end: `${year}-${String(value + 1).padStart(2, "0")}-01T03:00:00.000Z`,
  timezone: "America/Fortaleza",
  status,
  recommended_close_at: null,
  closed_at: status === "closed" ? "2026-08-04T12:00:00Z" : null,
  current_report_id: status === "closed" ? `report-${value}` : null,
});

const statement = (input: { paid?: number; expected: number; payments?: number }): MonthlyStatement => ({
  id: `statement-${input.expected}-${input.paid ?? 0}`,
  card_id: "card",
  card_name: "Cartão",
  official_total_amount: input.expected,
  calculated_total_amount: input.expected,
  reconciliation_difference: 0,
  reconciliation_status: "matched",
  official_amount_confirmed: true,
  official_amount_source: "provider",
  closing_date: "2026-07-03",
  due_date: "2026-07-10",
  cycle_start_date: null,
  cycle_end_date: null,
  statement_file_path: null,
  reference_month: "2026-07",
  expected_statement_amount: input.expected,
  current_open_amount: input.expected,
  detected_payment_amount: input.paid ?? 0,
  confirmed_payment_amount: input.paid ?? 0,
  payment_difference: (input.paid ?? 0) - input.expected,
  payment_confirmation_status: (input.paid ?? 0) >= input.expected ? "paid" : "partially_paid",
  payment_confirmation_source: input.paid ? "bank_transaction" : null,
  payment_confirmed_at: input.paid ? "2026-07-04" : null,
  statement_status: input.paid ? "paid" : "estimated",
  personal_share_amount: input.expected,
  third_party_share_amount: 0,
  third_party_people: [],
  personal_installment_purchase_count: 0,
  personal_installment_total_amount: 0,
  installment_purchase_count: 0,
  installment_total_amount: 0,
  payments: Array.from({ length: input.payments ?? (input.paid ? 1 : 0) }, (_, index) => ({
    id: `payment-${index}`,
    bankTransactionId: `transaction-${index}`,
    allocatedAmount: (input.paid ?? 0) / (input.payments ?? 1),
    paymentDate: "2026-07-04",
    paymentSource: "bank_transaction" as const,
    isManual: false,
    isThirdParty: false,
    description: "Pagamento cartão",
    accountName: "Conta",
  })),
});

test("mês fechado sai da área principal e permanece no histórico", () => {
  const months = [month(2026, 7, "closed"), month(2026, 8, "open"), month(2026, 9, "planned")];
  assert.deepEqual(selectActiveFinancialMonths(months, { year: 2026, month: 8 }).map(item => item.reference_month), [8, 9]);
  const history = selectClosedFinancialMonths([{ ...months[0], monthly_financial_reports: { id: "report", version: 1, status: "final", snapshot_json: {} as never, pdf_storage_path: "report.pdf", generated_at: "2026-08-04" } }]);
  assert.equal(history[0]?.month.reference_month, 7);
  assert.equal(history[0]?.report?.version, 1);
});

test("mês anterior pendente fica acima do vigente e oculta o próximo", () => {
  const months = [month(2026, 7, "review"), month(2026, 8, "open"), month(2026, 9, "planned")];
  assert.deepEqual(selectActiveFinancialMonths(months, { year: 2026, month: 8 }).map(item => item.reference_month), [7, 8]);
  assert.equal(getFinancialMonthAction("review"), "Revisar e concluir");
  assert.equal(getFinancialMonthAction("open"), "Acompanhar");
});

test("reabertura devolve o mês ao acompanhamento e preserva o histórico anterior", () => {
  const july = { ...month(2026, 7, "reopened"), current_report_id: "report-7" };
  assert.equal(getFinancialMonthDisplayState({ month: july, current: { year: 2026, month: 8 } }), "reopened");
  assert.deepEqual(selectActiveFinancialMonths([july, month(2026, 8, "open")], { year: 2026, month: 8 }).map(item => item.reference_month), [7, 8]);
  assert.equal(selectClosedFinancialMonths([july]).length, 1);
});

test("fatura paga, múltiplos pagamentos e pagamento parcial usam o mês do caixa", () => {
  assert.deepEqual(getStatementForCashMonth({ statements: [statement({ paid: 11517.22, expected: 11517.22, payments: 2 })] }), { kind: "paid", paid: 11517.22, expected: 11517.22 });
  assert.deepEqual(getStatementForCashMonth({ statements: [statement({ paid: 5000, expected: 11517.22 })] }), { kind: "partial", paid: 5000, expected: 11517.22 });
});

test("previsão e candidato não usam a próxima fatura na linha anterior", () => {
  const dueInMonth = statement({ expected: 7794.63 });
  assert.deepEqual(getStatementForCashMonth({ statements: [], reconciliationStatements: [dueInMonth] }), { kind: "forecast", forecast: 7794.63, expected: 7794.63 });
  assert.deepEqual(getStatementForCashMonth({ statements: [], reconciliationStatements: [dueInMonth], unmatchedPaymentCount: 1 }), { kind: "identified", paid: 0, expected: 7794.63 });
  assert.deepEqual(getStatementForCashMonth({ statements: [], reconciliationStatements: [] }), { kind: "unavailable" });
});

test("mês terminado com bloqueio pede atenção; sem bloqueio fica pronto para revisão", () => {
  const july = month(2026, 7, "awaiting_consolidation");
  assert.equal(getFinancialMonthDisplayState({ month: july, current: { year: 2026, month: 8 }, hasBlockingIssues: true }), "needs_attention");
  assert.equal(getFinancialMonthDisplayState({ month: july, current: { year: 2026, month: 8 }, hasBlockingIssues: false }), "review");
});
