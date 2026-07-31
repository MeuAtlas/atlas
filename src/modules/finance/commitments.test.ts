import assert from "node:assert/strict";
import test from "node:test";
import {
  allocatedAmountCents,
  buildMonthlyCommitmentProjections,
  dueDateForMonth,
  generateCommitmentOccurrences,
  resolveOccurrenceStatus,
  scoreCommitmentMatch,
  updateOccurrenceStatuses,
  validateAllocations,
  type FinancialCommitment,
} from "./commitments";

const commitment = (overrides: Partial<FinancialCommitment> = {}): FinancialCommitment => ({
  id: "00000000-0000-4000-8000-000000000001",
  workspaceId: "00000000-0000-4000-8000-000000000002",
  title: "Academia",
  description: null,
  commitmentType: "recurring",
  recurrenceFrequency: "monthly",
  recurrenceInterval: 1,
  amountType: "fixed",
  expectedAmountCents: 18_000,
  minimumExpectedAmountCents: null,
  maximumExpectedAmountCents: null,
  currencyCode: "BRL",
  categoryId: null,
  accountId: "00000000-0000-4000-8000-000000000003",
  cardId: null,
  paymentMethod: "bank_debit",
  dueDay: 10,
  dueDate: null,
  startDate: "2026-01-10",
  endDate: null,
  nextDueDate: "2026-01-10",
  status: "active",
  autoMatchEnabled: true,
  merchantMatchPattern: "ACADEMIA",
  descriptionMatchPattern: null,
  expectedDayTolerance: 5,
  expectedAmountToleranceCents: 500,
  source: "manual",
  sourceRecordId: null,
  isPayrollDeduction: false,
  generatesFutureProjections: true,
  lastGeneratedUntil: null,
  ...overrides,
});

test("gera 12 ocorrências mensais e preserva centavos", () => {
  const generated = generateCommitmentOccurrences({
    commitment: commitment(),
    from: "2026-01-01",
    until: "2026-12-31",
    today: "2026-01-01",
  });
  assert.equal(generated.length, 12);
  assert.equal(generated[0].expectedAmountCents, 18_000);
});

test("geração é idempotente pelas chaves de competência e sequência", () => {
  const existing = new Set([
    "00000000-0000-4000-8000-000000000001:2026-01-01:1",
    "00000000-0000-4000-8000-000000000001:2026-02-01:1",
  ]);
  const generated = generateCommitmentOccurrences({
    commitment: commitment(),
    from: "2026-01-01",
    until: "2026-02-28",
    existingKeys: existing,
  });
  assert.equal(generated.length, 0);
});

test("dia 31 usa último dia válido, inclusive fevereiro bissexto", () => {
  assert.equal(dueDateForMonth("2027-02-01", 31), "2027-02-28");
  assert.equal(dueDateForMonth("2028-02-01", 31), "2028-02-29");
});

test("recorrência anual respeita cadência", () => {
  const generated = generateCommitmentOccurrences({
    commitment: commitment({ recurrenceFrequency: "annual" }),
    from: "2026-01-01",
    until: "2028-12-31",
  });
  assert.deepEqual(
    generated.map(item => item.competenceMonth),
    ["2026-01-01", "2027-01-01", "2028-01-01"],
  );
});

test("semanal aceita mais de uma ocorrência por mês sem colisão", () => {
  const generated = generateCommitmentOccurrences({
    commitment: commitment({
      recurrenceFrequency: "weekly",
      startDate: "2026-07-03",
    }),
    from: "2026-07-01",
    until: "2026-07-31",
  });
  assert.deepEqual(generated.map(item => item.sequenceNumber), [1, 2, 3, 4, 5]);
  assert.equal(new Set(generated.map(item => item.expectedDueDate)).size, 5);
});

test("compromisso único gera exatamente uma ocorrência", () => {
  const generated = generateCommitmentOccurrences({
    commitment: commitment({
      commitmentType: "one_time",
      recurrenceFrequency: null,
      dueDate: "2026-08-18",
    }),
    from: "2026-08-01",
    until: "2027-08-01",
  });
  assert.equal(generated.length, 1);
  assert.equal(generated[0].expectedDueDate, "2026-08-18");
});

test("pausa, encerramento e projeção desativada preservam histórico e não geram futuro", () => {
  for (const overrides of [
    { status: "paused" as const },
    { status: "completed" as const },
    { generatesFutureProjections: false },
  ]) {
    assert.equal(generateCommitmentOccurrences({
      commitment: commitment(overrides),
      from: "2026-01-01",
      until: "2026-12-31",
    }).length, 0);
  }
});

test("desconto em folha entra como compromisso sem exigir conta", () => {
  const generated = generateCommitmentOccurrences({
    commitment: commitment({
      commitmentType: "payroll_deduction",
      isPayrollDeduction: true,
      accountId: null,
      paymentMethod: "payroll",
    }),
    from: "2026-01-01",
    until: "2026-03-31",
  });
  assert.equal(generated.length, 3);
});

test("desconto em folha vencido aguarda a folha e não fica atrasado", () => {
  const generated = generateCommitmentOccurrences({
    commitment: commitment({
      commitmentType: "payroll_deduction",
      isPayrollDeduction: true,
      accountId: null,
      paymentMethod: "payroll",
      startDate: "2026-07-01",
      dueDay: 5,
    }),
    from: "2026-07-01",
    until: "2026-08-31",
    today: "2026-07-29",
  });
  assert.deepEqual(
    generated.map(item => item.status),
    ["expected", "projected"],
  );
});

test("pagamento integral, parcial e atraso resolvem status no servidor", () => {
  assert.equal(resolveOccurrenceStatus({
    current: "pending", dueDate: "2026-07-10", expectedAmountCents: 10_000,
    actualAmountCents: 10_000, paymentDate: "2026-07-10", today: "2026-07-11",
  }), "paid");
  assert.equal(resolveOccurrenceStatus({
    current: "pending", dueDate: "2026-07-10", expectedAmountCents: 10_000,
    actualAmountCents: 4_000, today: "2026-07-11",
  }), "partially_paid");
  assert.equal(resolveOccurrenceStatus({
    current: "pending", dueDate: "2026-07-10", expectedAmountCents: 10_000,
    actualAmountCents: null, today: "2026-07-11",
  }), "overdue");
});

test("atualização em lote preserva skipped, cancelled e disputed", () => {
  const statuses = updateOccurrenceStatuses(
    ["skipped", "cancelled", "disputed"].map((status, index) => ({
      id: String(index), commitmentId: "c", competenceMonth: "2026-07-01",
      sequenceNumber: 1, expectedDueDate: "2026-07-01",
      expectedAmountCents: 100, actualAmountCents: null,
      status: status as "skipped" | "cancelled" | "disputed",
      paymentDate: null, linkedTransactionId: null, linkedCardMovementId: null,
      matchConfidence: null, matchSource: null, manuallyConfirmed: false,
    })),
    "2026-07-20",
  );
  assert.deepEqual(statuses.map(item => item.status), ["skipped", "cancelled", "disputed"]);
});

test("divisão integral, percentual e valor fixo calculam centavos corretamente", () => {
  assert.equal(allocatedAmountCents(120_000, {
    personId: "a", allocationType: "full", allocationValue: 100, isPrimary: true,
  }), 120_000);
  assert.equal(allocatedAmountCents(120_000, {
    personId: "a", allocationType: "percentage", allocationValue: 33.33, isPrimary: true,
  }), 39_996);
  assert.equal(allocatedAmountCents(120_000, {
    personId: "a", allocationType: "fixed_amount", allocationValue: 400, isPrimary: true,
  }), 40_000);
});

test("valida soma percentual em 100 e rejeita soma ou modo misto inválido", () => {
  assert.equal(validateAllocations([
    { personId: "a", allocationType: "percentage", allocationValue: 33.33, isPrimary: true },
    { personId: "b", allocationType: "percentage", allocationValue: 33.33, isPrimary: false },
    { personId: "c", allocationType: "percentage", allocationValue: 33.34, isPrimary: false },
  ], 120_000).valid, true);
  assert.equal(validateAllocations([
    { personId: "a", allocationType: "percentage", allocationValue: 80, isPrimary: true },
  ], 120_000).valid, false);
  assert.equal(validateAllocations([
    { personId: "a", allocationType: "percentage", allocationValue: 50, isPrimary: true },
    { personId: "b", allocationType: "fixed_amount", allocationValue: 500, isPrimary: false },
  ], 120_000).valid, false);
});

test("fixture de dependente totaliza recorrente e extraordinário", () => {
  const school = allocatedAmountCents(121_000, {
    personId: "person-a", allocationType: "full", allocationValue: 100, isPrimary: true,
  });
  const english = allocatedAmountCents(32_500, {
    personId: "person-a", allocationType: "full", allocationValue: 100, isPrimary: true,
  });
  const extraordinary = allocatedAmountCents(20_000, {
    personId: "person-a", allocationType: "full", allocationValue: 100, isPrimary: true,
  });
  assert.equal(school + english, 153_500);
  assert.equal(school + english + extraordinary, 173_500);
});

test("matching classifica scores alto, médio e baixo usando múltiplos sinais", () => {
  const occurrence = {
    id: "o", commitmentId: "c", competenceMonth: "2026-07-01",
    sequenceNumber: 1, expectedDueDate: "2026-07-10",
    expectedAmountCents: 18_000, actualAmountCents: null, status: "pending" as const,
    paymentDate: null, linkedTransactionId: null, linkedCardMovementId: null,
    matchConfidence: null, matchSource: null, manuallyConfirmed: false,
  };
  const high = scoreCommitmentMatch({
    occurrence, commitment: commitment(),
    transaction: { id: "t", description: "Academia", merchant: "ACADEMIA",
      amountCents: 18_000, date: "2026-07-10",
      accountId: "00000000-0000-4000-8000-000000000003" },
  });
  const medium = scoreCommitmentMatch({
    occurrence, commitment: commitment(),
    transaction: { id: "t", description: "Academia mensal",
      amountCents: 18_000, date: "2026-07-12" },
  });
  const low = scoreCommitmentMatch({
    occurrence, commitment: commitment(),
    transaction: { id: "t", description: "Mercado",
      amountCents: 4_000, date: "2026-07-25" },
  });
  assert.equal(high.decision, "automatic");
  assert.equal(medium.decision, "suggestion");
  assert.equal(low.decision, "ignored");
});

test("planejamento consolida fontes e evita duplicar fonte já filtrada", () => {
  const projections = buildMonthlyCommitmentProjections({
    occurrences: [
      { competenceMonth: "2026-08-01", expectedAmountCents: 100_000,
        actualAmountCents: null, status: "projected", commitmentType: "recurring",
        source: "manual" },
      { competenceMonth: "2026-08-01", expectedAmountCents: 30_000,
        actualAmountCents: 30_000, status: "paid", commitmentType: "payroll_deduction",
        source: "manual" },
      { competenceMonth: "2026-08-01", expectedAmountCents: 20_000,
        actualAmountCents: null, status: "cancelled", commitmentType: "one_time",
        source: "manual" },
    ],
    cardInstallments: [{ competenceMonth: "2026-08-01", amountCents: 25_000 }],
    loans: [{ competenceMonth: "2026-08-01", amountCents: 40_000 }],
  });
  assert.equal(projections[0].totalCommittedCents, 195_000);
  assert.equal(projections[0].payrollTotalCents, 30_000);
  assert.equal(projections[0].confirmedTotalCents, 30_000);
  assert.equal(projections[0].sourceCounts.card_installment, 1);
});
