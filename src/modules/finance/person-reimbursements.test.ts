import assert from "node:assert/strict";
import test from "node:test";
import {
  allocateReimbursementAmounts,
  buildSharedCommitmentProjection,
  calculateExpenseAllocations,
  calculatePersonExpenseNetCost,
  matchPixCounterpartyToPerson,
  normalizeCounterpartyName,
  resolvePersonPixRole,
  suggestReimbursementMatches,
  type PersonCounterpartyRule,
} from "./person-reimbursements";

const rule: PersonCounterpartyRule = {
  id: "counterparty",
  personId: "anna",
  providerCounterpartyId: "provider-anna",
  taxNumberHash: "tax-hash",
  pixKeyHash: "pix-hash",
  bankCode: "033",
  accountMasked: "***1234",
  normalizedName: "anna exemplo",
  directionScope: "both",
  isActive: true,
  manuallyConfirmed: true,
};

test("normaliza nome de contraparte sem acentos ou pontuação", () => {
  assert.equal(normalizeCounterpartyName("  Ánna  D'Ávila "), "anna d avila");
});
test("match por provider id é automático", () => {
  const match = matchPixCounterpartyToPerson({
    counterparty: { providerCounterpartyId: "provider-anna" },
    rules: [rule], direction: "incoming",
  });
  assert.equal(match?.matchSource, "provider_counterparty_id");
  assert.equal(match?.autoApplicable, true);
});
test("match por documento hash é automático", () => {
  const match = matchPixCounterpartyToPerson({
    counterparty: { taxNumberHash: "tax-hash" }, rules: [rule],
    direction: "incoming",
  });
  assert.equal(match?.confidence, 0.98);
});
test("match por chave hash é automático", () => {
  const match = matchPixCounterpartyToPerson({
    counterparty: { pixKeyHash: "pix-hash" }, rules: [rule],
    direction: "outgoing",
  });
  assert.equal(match?.confidence, 0.97);
});
test("match por conta mascarada gera sugestão", () => {
  const match = matchPixCounterpartyToPerson({
    counterparty: { bankCode: "033", accountMasked: "***1234" },
    rules: [rule], direction: "incoming",
  });
  assert.equal(match?.matchSource, "bank_account");
  assert.equal(match?.autoApplicable, false);
});
test("nome isolado confirmado fica abaixo da confiança máxima", () => {
  const match = matchPixCounterpartyToPerson({
    counterparty: { normalizedName: "Anna Exemplo" },
    rules: [rule], direction: "incoming",
  });
  assert.equal(match?.confidence, 0.84);
  assert.notEqual(match?.confidence, 1);
});
test("regra desativada não aplica", () => {
  assert.equal(matchPixCounterpartyToPerson({
    counterparty: { pixKeyHash: "pix-hash" },
    rules: [{ ...rule, isActive: false }], direction: "incoming",
  }), null);
});
test("escopo incoming rejeita outgoing", () => {
  assert.equal(matchPixCounterpartyToPerson({
    counterparty: { pixKeyHash: "pix-hash" },
    rules: [{ ...rule, directionScope: "incoming_only" }],
    direction: "outgoing",
  }), null);
});
test("Pix recebido permanece entrada", () => {
  const role = resolvePersonPixRole({ bankDirection: "inflow" });
  assert.equal(role.bankDirection, "inflow");
  assert.equal(role.personFlowRole, "received_from_person");
});
test("Pix enviado permanece saída", () => {
  const role = resolvePersonPixRole({ bankDirection: "outflow" });
  assert.equal(role.bankDirection, "outflow");
  assert.equal(role.personFlowRole, "sent_to_person");
});
test("reembolso é entrada neutra para renda", () => {
  const role = resolvePersonPixRole({
    bankDirection: "inflow", asReimbursement: true,
  });
  assert.equal(role.bankDirection, "inflow");
  assert.equal(role.incomeEffect, "neutral");
  assert.equal(role.cashFlowEffect, "inflow");
});
test("adiantamento enviado preserva saída", () => {
  const role = resolvePersonPixRole({
    bankDirection: "outflow", asAdvance: true,
  });
  assert.equal(role.personFlowRole, "advance_to_person");
});
test("divisão fixa", () => {
  const result = calculateExpenseAllocations(30_000, [
    { personId: "self", allocationType: "fixed_amount", allocationValue: 15_000, reimbursable: false },
    { personId: "anna", allocationType: "fixed_amount", allocationValue: 15_000, reimbursable: true },
  ]);
  assert.deepEqual(result.map(item => item.allocatedAmountCents), [15_000, 15_000]);
});
test("divisão percentual", () => {
  const result = calculateExpenseAllocations(30_000, [
    { personId: "self", allocationType: "percentage", allocationValue: 50, reimbursable: false },
    { personId: "anna", allocationType: "percentage", allocationValue: 50, reimbursable: true },
  ]);
  assert.equal(result[1].reimbursableAmountCents, 15_000);
});
test("valor fixo mais restante no caso Wellhub", () => {
  const result = calculateExpenseAllocations(30_000, [
    { personId: "self", allocationType: "fixed_amount", allocationValue: 15_000, reimbursable: false },
    { personId: "anna", allocationType: "remainder", allocationValue: 0, reimbursable: true },
  ]);
  assert.deepEqual(result.map(item => item.allocatedAmountCents), [15_000, 15_000]);
});
test("valor restante absorve aumento para 320", () => {
  const result = calculateExpenseAllocations(32_000, [
    { personId: "self", allocationType: "fixed_amount", allocationValue: 15_000, reimbursable: false },
    { personId: "anna", allocationType: "remainder", allocationValue: 0, reimbursable: true },
  ]);
  assert.equal(result[1].allocatedAmountCents, 17_000);
});
test("divisão incompleta é rejeitada", () => {
  assert.throws(() => calculateExpenseAllocations(30_000, [
    { personId: "self", allocationType: "fixed_amount", allocationValue: 10_000, reimbursable: false },
  ]), /cobrir todo/);
});
test("divisão duplicada por pessoa é rejeitada", () => {
  assert.throws(() => calculateExpenseAllocations(100, [
    { personId: "self", allocationType: "fixed_amount", allocationValue: 50, reimbursable: false },
    { personId: "self", allocationType: "remainder", allocationValue: 0, reimbursable: false },
  ]), /duas vezes/);
});
test("Pix exato quita um reembolso", () => {
  const result = allocateReimbursementAmounts(15_000, [
    { id: "wellhub", pendingAmountCents: 15_000 },
  ]);
  assert.equal(result.unallocatedAmountCents, 0);
  assert.equal(result.allocations[0].allocatedAmountCents, 15_000);
});
test("Pix parcial deixa saldo para a despesa", () => {
  const result = allocateReimbursementAmounts(10_000, [
    { id: "wellhub", pendingAmountCents: 15_000 },
  ]);
  assert.equal(result.allocations[0].allocatedAmountCents, 10_000);
});
test("segundo Pix pode quitar o restante", () => {
  const result = allocateReimbursementAmounts(5_000, [
    { id: "wellhub", pendingAmountCents: 5_000 },
  ]);
  assert.equal(result.unallocatedAmountCents, 0);
});
test("um Pix cobre duas despesas", () => {
  const result = allocateReimbursementAmounts(30_000, [
    { id: "august", pendingAmountCents: 15_000 },
    { id: "september", pendingAmountCents: 15_000 },
  ]);
  assert.equal(result.allocations.length, 2);
  assert.equal(result.unallocatedAmountCents, 0);
});
test("excedente permanece não alocado", () => {
  const result = allocateReimbursementAmounts(20_000, [
    { id: "wellhub", pendingAmountCents: 15_000 },
  ]);
  assert.equal(result.unallocatedAmountCents, 5_000);
});
test("custo líquido do caso Wellhub é 150", () => {
  const result = calculatePersonExpenseNetCost({
    grossExpenseAmountCents: 30_000,
    userResponsibilityAmountCents: 15_000,
    otherPeopleResponsibilityAmountCents: 15_000,
    reimbursedAmountCents: 15_000,
  });
  assert.deepEqual(result, {
    grossExpenseAmountCents: 30_000,
    userResponsibilityAmountCents: 15_000,
    otherPeopleResponsibilityAmountCents: 15_000,
    reimbursedAmountCents: 15_000,
    pendingReimbursementAmountCents: 0,
    netUserCostCents: 15_000,
    totalPaidInitiallyByUserCents: 30_000,
  });
});
test("reembolso parcial preserva custo temporário e saldo", () => {
  const result = calculatePersonExpenseNetCost({
    grossExpenseAmountCents: 30_000,
    userResponsibilityAmountCents: 15_000,
    otherPeopleResponsibilityAmountCents: 15_000,
    reimbursedAmountCents: 10_000,
  });
  assert.equal(result.pendingReimbursementAmountCents, 5_000);
  assert.equal(result.netUserCostCents, 20_000);
});
test("sugestão de valor exato e mesma pessoa tem score alto", () => {
  const suggestions = suggestReimbursementMatches({
    personId: "anna", amountCents: 15_000, receivedDate: "2026-08-10",
    expenses: [{
      id: "wellhub", personId: "anna", pendingAmountCents: 15_000,
      dueDate: "2026-08-10", commitmentActive: true,
      counterpartyConfirmed: true,
    }],
  });
  assert.ok(suggestions[0].confidence >= 0.9);
  assert.equal(suggestions[0].autoApplicable, false);
});
test("sugestão não mistura pessoa", () => {
  assert.equal(suggestReimbursementMatches({
    personId: "anna", amountCents: 100, receivedDate: "2026-08-10",
    expenses: [{ id: "x", personId: "outra", pendingAmountCents: 100 }],
  }).length, 0);
});
test("planejamento usa custo líquido e não trata reembolso como renda", () => {
  assert.deepEqual(buildSharedCommitmentProjection({
    grossAmountCents: 30_000,
    userResponsibilityCents: 15_000,
    reimbursementReceivedCents: 5_000,
  }), {
    grossAmountCents: 30_000,
    userResponsibilityCents: 15_000,
    reimbursementExpectedCents: 15_000,
    reimbursementReceivedCents: 5_000,
    netProjectedCostCents: 15_000,
  });
});
