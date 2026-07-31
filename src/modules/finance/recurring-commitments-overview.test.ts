import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type {
  CommitmentOccurrence,
  FinancialCommitment,
} from "./commitments";
import {
  filterRecurringCommitmentGroups,
  getRecurringCommitmentsOverview,
  type RecurringCommitmentSource,
} from "./recurring-commitments-overview";

const root = process.cwd();

function commitment(
  id: string,
  title: string,
  amountCents: number,
  overrides: Partial<FinancialCommitment> = {},
): FinancialCommitment {
  return {
    id,
    workspaceId: "00000000-0000-4000-8000-000000000001",
    title,
    description: null,
    commitmentType: "recurring",
    recurrenceFrequency: "monthly",
    recurrenceInterval: 1,
    amountType: "fixed",
    expectedAmountCents: amountCents,
    minimumExpectedAmountCents: null,
    maximumExpectedAmountCents: null,
    currencyCode: "BRL",
    categoryId: "category",
    accountId: "account",
    cardId: null,
    paymentMethod: "bank_debit",
    dueDay: 10,
    dueDate: null,
    startDate: "2026-07-01",
    endDate: null,
    nextDueDate: "2026-07-10",
    status: "active",
    autoMatchEnabled: true,
    merchantMatchPattern: null,
    descriptionMatchPattern: null,
    expectedDayTolerance: 5,
    expectedAmountToleranceCents: null,
    source: "manual",
    sourceRecordId: null,
    isPayrollDeduction: false,
    generatesFutureProjections: true,
    lastGeneratedUntil: "2026-08-31",
    cashFlowDirection: "expense",
    includeInMonthlyBudget: true,
    ...overrides,
  };
}

function occurrence(
  commitmentId: string,
  amountCents: number,
  overrides: Partial<CommitmentOccurrence> = {},
): CommitmentOccurrence {
  return {
    id: `occurrence-${commitmentId}`,
    commitmentId,
    competenceMonth: "2026-07-01",
    sequenceNumber: 1,
    expectedDueDate: "2026-07-20",
    expectedAmountCents: amountCents,
    actualAmountCents: null,
    status: "expected",
    paymentDate: null,
    linkedTransactionId: null,
    linkedCardMovementId: null,
    matchConfidence: null,
    matchSource: null,
    manuallyConfirmed: false,
    ...overrides,
  };
}

function source(
  item: FinancialCommitment,
  people: RecurringCommitmentSource["people"] = [],
  overrides: Partial<RecurringCommitmentSource> = {},
): RecurringCommitmentSource {
  return {
    commitment: item,
    categoryName: "Serviços",
    accountName: "Conta principal",
    cardName: null,
    people,
    occurrence: occurrence(
      item.id,
      item.expectedAmountCents ?? 0,
    ),
    ...overrides,
  };
}

const anna = { id: "anna", name: "Anna Letícia", isDependent: true };
const isis = { id: "isis", name: "Maria Ísis", isDependent: true };

function fixture() {
  return [
    source(commitment("internet", "Internet", 11_138), [], {
      occurrence: occurrence("internet", 11_138, {
        status: "paid",
        actualAmountCents: 11_138,
        paymentDate: "2026-07-10",
        linkedTransactionId: "transaction-internet",
      }),
    }),
    source(commitment("academia", "Academia", 18_000)),
    source(commitment("escola", "Escola", 121_000), [anna]),
    source(commitment("ingles", "Inglês", 32_500, { dueDay: 5 }), [anna], {
      occurrence: occurrence("ingles", 32_500, {
        expectedDueDate: "2026-07-05",
        status: "overdue",
      }),
    }),
    source(commitment("pensao", "Pensão", 243_150, {
      commitmentType: "payroll_deduction",
      isPayrollDeduction: true,
      paymentMethod: "payroll",
      accountId: null,
    }), [isis], {
      occurrence: occurrence("pensao", 243_150, {
        status: "paid",
        actualAmountCents: 243_150,
        paymentDate: "2026-07-01",
      }),
    }),
    source(commitment("condominio", "Condomínio", 60_000, {
      analysisGroupId: "household",
      analysisGroupName: "Casa",
      analysisGroupType: "household",
    })),
  ];
}

test("fixture agrupa próprias, dependentes e Casa com os totais esperados", () => {
  const result = getRecurringCommitmentsOverview({
    workspaceId: "workspace",
    competenceMonth: "2026-07",
    sources: fixture(),
    today: "2026-07-15",
  });
  assert.equal(result.ownRecurring, 29_138);
  assert.equal(result.dependentsRecurring, 396_650);
  assert.equal(result.householdRecurring, 60_000);
  assert.equal(result.totalRecurring, 485_788);
  assert.deepEqual(
    result.groups.map(group => group.contextName),
    ["Minhas contas", "Casa", "Anna Letícia", "Maria Ísis"],
  );
});

test("compromisso próprio aparece em Minhas contas sem criar pessoa Eu", () => {
  const result = getRecurringCommitmentsOverview({
    workspaceId: "workspace",
    competenceMonth: "2026-07",
    sources: fixture(),
    today: "2026-07-15",
  });
  const own = result.groups.find(group => group.groupType === "own");
  assert.deepEqual(own?.items.map(item => item.title), ["Internet", "Academia"]);
  assert.equal(result.groups.some(group => group.contextName === "Eu"), false);
});

test("Anna e Maria Ísis recebem somente as próprias recorrências", () => {
  const result = getRecurringCommitmentsOverview({
    workspaceId: "workspace",
    competenceMonth: "2026-07",
    sources: fixture(),
    today: "2026-07-15",
  });
  assert.deepEqual(
    result.groups.find(group => group.personId === "anna")?.items
      .map(item => item.title),
    ["Inglês", "Escola"],
  );
  assert.deepEqual(
    result.groups.find(group => group.personId === "isis")?.items
      .map(item => item.title),
    ["Pensão"],
  );
});

test("Casa tem agrupamento prioritário e não duplica em Minhas contas", () => {
  const result = getRecurringCommitmentsOverview({
    workspaceId: "workspace",
    competenceMonth: "2026-07",
    sources: fixture(),
    today: "2026-07-15",
  });
  assert.equal(
    result.occurrences.filter(item => item.commitmentId === "condominio").length,
    1,
  );
  assert.equal(
    result.groups.find(group => group.groupType === "own")?.items
      .some(item => item.commitmentId === "condominio"),
    false,
  );
});

test("receita e salário não entram na visão recorrente", () => {
  const sources = fixture().concat([
    source(commitment("salary", "Crédito de salário", 900_000, {
      cashFlowDirection: "income",
    })),
    source(commitment("income", "Receita recorrente", 100_000, {
      cashFlowDirection: "income",
    })),
  ]);
  const result = getRecurringCommitmentsOverview({
    workspaceId: "workspace",
    competenceMonth: "2026-07",
    sources,
    today: "2026-07-15",
  });
  assert.equal(result.totalRecurring, 485_788);
  assert.equal(result.occurrences.some(item => item.commitmentId === "salary"), false);
});

test("pago, pendente e atraso usam uma única linha da ocorrência", () => {
  const result = getRecurringCommitmentsOverview({
    workspaceId: "workspace",
    competenceMonth: "2026-07",
    sources: fixture(),
    today: "2026-07-15",
  });
  assert.equal(result.paidAmount, 254_288);
  assert.equal(result.overdueAmount, 32_500);
  assert.equal(result.pendingAmount, 231_500);
  assert.equal(
    result.occurrences.filter(item => item.commitmentId === "internet").length,
    1,
  );
});

test("compra de cartão vinculada continua sendo uma única conta", () => {
  const card = source(commitment("spotify", "Spotify", 2_361, {
    paymentMethod: "credit_card",
    cardId: "card",
    accountId: null,
  }), [], {
    cardName: "Santander · 5718",
    accountName: null,
    occurrence: occurrence("spotify", 2_361, {
      status: "paid",
      actualAmountCents: 2_361,
      linkedCardMovementId: "card-purchase",
    }),
  });
  const result = getRecurringCommitmentsOverview({
    workspaceId: "workspace",
    competenceMonth: "2026-07",
    sources: [card],
    today: "2026-07-15",
  });
  assert.equal(result.occurrences.length, 1);
  assert.equal(result.paidAmount, 2_361);
});

test("pausado aparece com status próprio mas não entra no total ativo", () => {
  const paused = source(commitment("paused", "Pausado", 10_000, {
    status: "paused",
  }));
  const result = getRecurringCommitmentsOverview({
    workspaceId: "workspace",
    competenceMonth: "2026-07",
    sources: [paused],
    today: "2026-07-15",
  });
  assert.equal(result.totalRecurring, 0);
  assert.equal(result.occurrences[0].status, "paused");
});

test("encerrado fica preservado na origem mas fora da lista ativa", () => {
  const completed = source(commitment("completed", "Encerrado", 10_000, {
    status: "completed",
  }));
  const result = getRecurringCommitmentsOverview({
    workspaceId: "workspace",
    competenceMonth: "2026-07",
    sources: [completed],
    today: "2026-07-15",
  });
  assert.equal(result.occurrences.length, 0);
});

test("filtros Minhas, Dependentes e Casa mantêm somente o grupo escolhido", () => {
  const result = getRecurringCommitmentsOverview({
    workspaceId: "workspace",
    competenceMonth: "2026-07",
    sources: fixture(),
    today: "2026-07-15",
  });
  assert.deepEqual(
    filterRecurringCommitmentGroups(result.groups, "own")
      .map(group => group.groupType),
    ["own"],
  );
  assert.equal(
    filterRecurringCommitmentGroups(result.groups, "dependents")
      .every(group => group.groupType === "dependent"),
    true,
  );
  assert.deepEqual(
    filterRecurringCommitmentGroups(result.groups, "household")
      .map(group => group.groupType),
    ["household"],
  );
});

test("ocorrência ausente não esconde compromisso e produz alerta acionável", () => {
  const missing = source(commitment("missing", "Sem ocorrência", 10_000), [], {
    occurrence: null,
  });
  const result = getRecurringCommitmentsOverview({
    workspaceId: "workspace",
    competenceMonth: "2026-07",
    sources: [missing],
    today: "2026-07-15",
  });
  assert.equal(result.occurrences.length, 1);
  assert.match(result.warnings.join(" "), /gerar a ocorrência/);
});

test("interface possui grupos, filtros móveis e linhas sem tabela horizontal", () => {
  const ui = readFileSync(
    `${root}/src/components/finance/commitments/commitments-workspace.tsx`,
    "utf8",
  );
  const css = readFileSync(`${root}/src/app/globals.css`, "utf8");
  assert.match(ui, /Contas recorrentes/);
  assert.match(ui, /recurring-mobile-filter/);
  assert.match(ui, /recurring-account-list/);
  assert.match(css, /@media\(max-width:760px\)/);
  assert.match(css, /\.recurring-account-list>button\{display:grid/);
});

test("migration cria Casa, FK, índice e valida escopo por workspace", () => {
  const migration = readFileSync(
    `${root}/supabase/migrations/202607300060_recurring_commitment_household_context.sql`,
    "utf8",
  );
  const base = readFileSync(
    `${root}/supabase/migrations/202607280046_financial_entities_and_rules.sql`,
    "utf8",
  );
  assert.match(migration, /analysis_group_id uuid/);
  assert.match(migration, /group_type = 'household'/);
  assert.match(migration, /analysis_group\.workspace_id = new\.workspace_id/);
  assert.match(migration, /validate_commitment_analysis_group/);
  assert.match(base, /alter table public\.%I enable row level security/);
  assert.match(base, /'financial_analysis_groups'/);
});

test("invalidação cobre compromissos, pessoas, planejamento, visão e relatórios", () => {
  const cache = readFileSync(
    `${root}/src/modules/finance/commitments-cache.ts`,
    "utf8",
  );
  for (const tag of [
    "commitmentsCacheTag",
    "peopleCacheTag",
    "personCacheTag",
    "planningCacheTag",
    "overviewCacheTag",
    "reportsCacheTag",
  ]) assert.match(cache, new RegExp(tag));
});
