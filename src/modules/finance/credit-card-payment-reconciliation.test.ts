import assert from "node:assert/strict";
import test from "node:test";

import {
  buildMonthlyCardCashSummary,
  calculateNextIncomeCommitment,
  calculateStatementPaymentStatus,
  findCreditCardPaymentCandidates,
  identifyCreditCardPaymentTransaction,
  type StatementPayment,
} from "./credit-card-payment-reconciliation";
import type { FinancialTransaction } from "./types";

const transaction = (overrides: Partial<FinancialTransaction> = {}): FinancialTransaction => ({
  id: "payment-1", description: "PAGAMENTO FATURA CARTAO", amount: 11_517.22,
  original_amount: -11_517.22, transaction_type: "transfer",
  transaction_role: "invoice_payment", source_type: "bank",
  financial_origin: "invoice", status: "realized", competence_date: "2026-07-08",
  due_date: null, realized_at: "2026-07-08T10:00:00Z", source: "pluggy",
  visibility: "workspace", account_id: "account-1", credit_card_id: "card-1",
  invoice_id: "statement-1", destination_account_id: null, category_id: null,
  workspace_id: "workspace-1", bank_direction: "outflow", ...overrides,
});

const payment = (amount: number, id = crypto.randomUUID(), source: StatementPayment["paymentSource"] = "bank_transaction"): StatementPayment => ({
  id, bankTransactionId: source === "direct_third_party_payment" ? null : `tx-${id}`,
  allocatedAmount: amount, paymentDate: "2026-07-08", paymentSource: source,
  isManual: false, isThirdParty: source === "direct_third_party_payment",
});

test("pagamento bancário da fatura é saída e usa a data real do débito", () => {
  const result = identifyCreditCardPaymentTransaction(transaction());
  assert.equal(result.isCandidate, true);
  assert.equal(result.paymentDate, "2026-07-08");
  assert.equal(result.amount, 11_517.22);
  assert.equal(result.confidence, "high");
});

test("pagamento antecipado e atrasado pertencem ao mês em que ocorreram", () => {
  assert.equal(identifyCreditCardPaymentTransaction(transaction({ realized_at: "2026-06-28T12:00:00Z" })).paymentDate, "2026-06-28");
  assert.equal(identifyCreditCardPaymentTransaction(transaction({ realized_at: "2026-08-12T12:00:00Z" })).paymentDate, "2026-08-12");
});

test("candidato de alta confiança exige vínculo, valor e data compatíveis", () => {
  const candidates = findCreditCardPaymentCandidates({
    transaction: transaction(),
    statements: [{ id: "statement-1", cardId: "card-1", expectedAmount: 11_517.22, closingDate: "2026-07-03", dueDate: "2026-07-10" }],
  });
  assert.equal(candidates[0]?.confidence, "high");
});

test("múltiplos pagamentos são somados e quitam a fatura", () => {
  assert.equal(calculateStatementPaymentStatus({ expectedAmount: 11_517.22, payments: [payment(5_000), payment(6_517.22)] }), "paid");
});

test("pagamento parcial usa apenas o valor efetivamente pago", () => {
  assert.equal(calculateStatementPaymentStatus({ expectedAmount: 11_517.22, payments: [payment(8_000)] }), "partially_paid");
});

test("pagamento maior que a fatura gera overpaid", () => {
  assert.equal(calculateStatementPaymentStatus({ expectedAmount: 11_517.22, payments: [payment(12_000)] }), "overpaid");
});

test("pagamento direto por terceiro quita sem virar saída pessoal", () => {
  const summary = buildMonthlyCardCashSummary({
    statements: [{ expectedAmount: 11_517.22, payments: [payment(9_517.22), payment(2_000, "third", "direct_third_party_payment")], personalShare: 9_517.22, thirdPartyShare: 2_000 }],
    reimbursementsReceived: 0, reimbursementsPending: 0,
  });
  assert.equal(summary.grossCardPayment, 9_517.22);
  assert.equal(summary.totalSettled, 11_517.22);
  assert.equal(summary.directThirdPartyPayments, 2_000);
  assert.equal(summary.netPersonalCardCost, 9_517.22);
});

test("débito bancário identificado entra no caixa antes da conciliação da fatura", () => {
  const candidate = payment(11_517.22, "july-card-payment");
  const summary = buildMonthlyCardCashSummary({
    statements: [],
    unmatchedBankPayments: [candidate],
    reimbursementsReceived: 0,
    reimbursementsPending: 0,
  });
  assert.equal(summary.grossCardPayment, 11_517.22);
  assert.equal(summary.netPersonalCardCost, 11_517.22);
});

test("mesma transação conciliada e candidata não duplica o pagamento", () => {
  const confirmed = payment(11_517.22, "same-transaction");
  const summary = buildMonthlyCardCashSummary({
    statements: [{
      expectedAmount: 11_517.22,
      payments: [confirmed],
      personalShare: 11_517.22,
      thirdPartyShare: 0,
    }],
    unmatchedBankPayments: [confirmed],
    reimbursementsReceived: 0,
    reimbursementsPending: 0,
  });
  assert.equal(summary.grossCardPayment, 11_517.22);
});

test("reembolso não vira renda e reduz o custo líquido pessoal", () => {
  const summary = buildMonthlyCardCashSummary({
    statements: [{ expectedAmount: 11_517.22, payments: [payment(11_517.22)], personalShare: 8_236.4, thirdPartyShare: 3_280.82 }],
    reimbursementsReceived: 1_865, reimbursementsPending: 1_415.82,
  });
  assert.equal(summary.grossCardPayment, 11_517.22);
  assert.equal(summary.netPersonalCardCost, 9_652.22);
  assert.equal(summary.reimbursementsReceived, 1_865);
});

test("parte de terceiros não compromete a próxima renda", () => {
  const commitment = calculateNextIncomeCommitment({
    openStatementPersonalShare: 6_700, recurringCommitments: 2_000,
    loans: 1_000, otherConfirmedCommitments: 300, expectedIncome: 20_000,
  });
  assert.equal(commitment.amount, 10_000);
  assert.equal(commitment.percentage, 50);
});
