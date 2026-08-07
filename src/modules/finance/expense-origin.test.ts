import assert from "node:assert/strict";
import test from "node:test";
import {
  buildExpenseOriginGroups,
  classifyExpenseOrigin,
  expensePresentationStatus,
  openExpenseAmountCents,
} from "./expense-origin";
import type { IncomeExpenseListItem } from "./income-expenses-query";

const base = (overrides: Partial<IncomeExpenseListItem> = {}): IncomeExpenseListItem => ({
  id: crypto.randomUUID(), occurrenceId: null, categoryId: null, accountId: null,
  cardId: null, personId: null, title: "Despesa", description: null,
  direction: "expense", recurrenceFrequency: "monthly", expectedDateDay: null,
  estimationMethod: "fixed", aggregationMode: "single_occurrence",
  contextType: "personal", status: "active", expectedAmountCents: 10000,
  realizedAmountCents: 0, differenceCents: -10000, occurrenceStatus: "pending",
  competenceMonth: "2026-08-01", expectedDate: "2026-08-10", paymentDate: null,
  paymentMethod: "boleto", paymentSourceName: null, settlementSource: null,
  linkedInvoiceId: null, linkedTransactionId: null, creditsCount: 0,
  historicalMedianCents: null, historicalAverageCents: null,
  historicalMonthsCount: 0, incomeBasis: null, cashFlowEffect: "outflow",
  planningEffect: "decrease", analyticsEffect: "expense", paymentChannel: "bank",
  isPayrollDeduction: false, categoryName: null, personNames: [], ...overrides,
});

test("classifica cada despesa por origem estruturada sem duplicidade", () => {
  const bank = base({ accountId: "account" });
  const card = base({ cardId: "card", paymentChannel: "card" });
  const payroll = base({ paymentMethod: "payroll", isPayrollDeduction: true });
  const unknown = base({ paymentMethod: null, paymentChannel: "other" });
  assert.equal(classifyExpenseOrigin(bank), "bank_account");
  assert.equal(classifyExpenseOrigin(card), "credit_card");
  assert.equal(classifyExpenseOrigin(payroll), "payroll");
  assert.equal(classifyExpenseOrigin(unknown), "unknown");
  const groups = buildExpenseOriginGroups([bank, card, payroll, unknown], "2026-08-05");
  assert.equal(groups.summary.count, 4);
  assert.deepEqual(groups.groups.map(group => group.summary.count), [1, 1, 1, 1]);
});

test("calcula aberto, parcial, atraso, cartão e folha corretamente", () => {
  const partial = base({ realizedAmountCents: 6000 });
  assert.equal(openExpenseAmountCents(partial), 4000);
  assert.equal(expensePresentationStatus(partial, "2026-08-05"), "partial");
  assert.equal(expensePresentationStatus(base({ expectedDate: "2026-08-01" }), "2026-08-05"), "overdue");
  assert.equal(expensePresentationStatus(base({ cardId: "card", paymentChannel: "card" }), "2026-08-05"), "card_planned");
  const payroll = base({ isPayrollDeduction: true, paymentMethod: "payroll" });
  assert.equal(openExpenseAmountCents(payroll), 0);
  assert.equal(expensePresentationStatus(payroll, "2026-08-05"), "payroll_paid");
});

test("baixa uma despesa variável pelo valor efetivamente pago", () => {
  const variable = base({
    amountType: "variable",
    expectedAmountCents: 140375,
    realizedAmountCents: 140335,
  });
  const result = buildExpenseOriginGroups([variable], "2026-08-05");
  assert.equal(openExpenseAmountCents(variable), 0);
  assert.equal(expensePresentationStatus(variable, "2026-08-05"), "paid");
  assert.equal(result.summary.totalCents, 140335);
  assert.equal(result.summary.paidCents, 140335);
  assert.equal(result.summary.openCents, 0);
});
