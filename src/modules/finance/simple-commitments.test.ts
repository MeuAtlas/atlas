import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  getSimpleCommitmentProjection,
  parseBrazilianMoneyToCents,
  parseCommitmentNaturalLanguage,
  relationTargetParts,
} from "./simple-commitments";

const read = (file: string) => readFileSync(
  path.join(process.cwd(), file),
  "utf8",
);

test("valor pt-BR é convertido para centavos sem ambiguidade", () => {
  assert.equal(parseBrazilianMoneyToCents("R$ 1.210,00"), 121_000);
  assert.equal(parseBrazilianMoneyToCents("111,38"), 11_138);
  assert.equal(parseBrazilianMoneyToCents("0"), null);
});

test("parser reconhece Escola da Anna mensal e vencimento dia 5", () => {
  const parsed = parseCommitmentNaturalLanguage(
    "Escola da Anna, R$ 1.210 por mês, vence dia 5.",
    { peopleNames: ["Anna"], today: "2026-07-30" },
  );
  assert.equal(parsed.title, "Escola da Anna");
  assert.equal(parsed.amountCents, 121_000);
  assert.equal(parsed.recurrence, "monthly");
  assert.equal(parsed.dueDay, 5);
  assert.equal(parsed.personName, "Anna");
  assert.equal(parsed.confidence, 1);
  assert.deepEqual(parsed.missingFields, []);
});

test("parser reconhece consulta única com data completa", () => {
  const parsed = parseCommitmentNaturalLanguage(
    "Consulta médica, R$ 350 no dia 22 de agosto.",
    { today: "2026-07-30" },
  );
  assert.equal(parsed.recurrence, "none");
  assert.equal(parsed.dueDate, "2026-08-22");
  assert.equal(parsed.amountCents, 35_000);
});

test("parser reconhece contexto Casa sem criar pessoa", () => {
  const parsed = parseCommitmentNaturalLanguage(
    "Internet de casa, R$ 111,38 todo mês, dia 10.",
    { peopleNames: ["Casa"], today: "2026-07-30" },
  );
  assert.equal(parsed.context, "household");
  assert.equal(parsed.personName, null);
  assert.equal(relationTargetParts("household").personId, null);
});

test("parser incompleto não inventa valor, data ou frequência", () => {
  const parsed = parseCommitmentNaturalLanguage("Academia");
  assert.equal(parsed.title, "Academia");
  assert.equal(parsed.amountCents, null);
  assert.equal(parsed.recurrence, null);
  assert.equal(parsed.dueDate, null);
  assert.deepEqual(parsed.missingFields, [
    "amount", "schedule", "recurrence",
  ]);
});

test("Pessoal, Casa, Trabalho, Viagem e pessoa têm persistência distinta", () => {
  assert.deepEqual(relationTargetParts("personal"), {
    personId: null,
    contextType: "personal",
  });
  assert.deepEqual(relationTargetParts("household"), {
    personId: null,
    contextType: "household",
  });
  assert.deepEqual(relationTargetParts("work"), {
    personId: null,
    contextType: "work",
  });
  assert.deepEqual(relationTargetParts("travel"), {
    personId: null,
    contextType: "travel",
  });
  assert.deepEqual(
    relationTargetParts("person:9c0e09f4-98b3-4560-b0ff-d891e9e2b670"),
    {
      personId: "9c0e09f4-98b3-4560-b0ff-d891e9e2b670",
      contextType: "personal",
    },
  );
});

test("Planejamento simples preserva prioridade desconhecida", () => {
  const projection = getSimpleCommitmentProjection({
    month: "2026-08",
    expectedIncomeCents: 500_000,
    commitments: [
      {
        amountCents: 100_000,
        commitmentType: "recurring",
        budgetPriority: "essential",
        status: "pending",
      },
      {
        amountCents: 20_000,
        commitmentType: "one_time",
        budgetPriority: "optional",
        status: "projected",
      },
      {
        amountCents: 10_000,
        commitmentType: "recurring",
        budgetPriority: "unknown",
        status: "pending",
      },
    ],
  });
  assert.equal(projection.totalCommitted, 130_000);
  assert.equal(projection.essentialCommitments, 100_000);
  assert.equal(projection.optionalCommitments, 20_000);
  assert.equal(projection.unknownCommitments, 10_000);
  assert.equal(projection.remainingAmount, 370_000);
  assert.equal(projection.potentialSavings, 20_000);
});

test("fluxo principal tem cinco perguntas, texto livre e detalhes opcionais", () => {
  const component = read(
    "src/components/finance/commitments/simple-commitment-modal.tsx",
  );
  const workspace = read(
    "src/components/finance/commitments/commitments-workspace.tsx",
  );
  assert.match(component, /Descreva o compromisso/);
  assert.match(component, /Prefiro preencher manualmente/);
  assert.match(component, /1\. O que é\?/);
  assert.match(component, /2\. Quanto custa\?/);
  assert.match(component, /3\. Quando acontece\?|3\. Primeiro vencimento/);
  assert.match(component, /4\. Repete\?/);
  assert.match(component, /5\. É relacionado a quem ou a quê\?/);
  assert.match(component, /Mais detalhes/);
  assert.match(workspace, />\s*Adicionar compromisso\s*</);
  assert.doesNotMatch(workspace, />\s*Novo compromisso\s*</);
});

test("action simples aplica defaults internos e não pede projeção", () => {
  const actions = read("src/modules/finance/commitments-actions.ts");
  assert.match(actions, /export async function createSimpleCommitment/);
  assert.match(actions, /parsed\.recurrence === "none" \? "one_time" : "recurring"/);
  assert.match(actions, /adapted\.set\("projection_confirmation", "true"\)/);
  assert.match(actions, /adapted\.set\("generates_future_projections", "true"\)/);
  assert.match(actions, /currency_code: "BRL"/);
  assert.match(actions, /export async function createCommitmentFromMovement/);
  assert.match(actions, /export async function updateSimpleCommitment/);
});

test("migration adiciona contextos, prioridade, histórico e RLS", () => {
  const migration = read(
    "supabase/migrations/202607300061_simplify_financial_commitments_creation.sql",
  );
  assert.match(migration, /context_type in \('personal', 'household', 'work', 'travel'\)/);
  assert.match(migration, /budget_priority/);
  assert.match(migration, /create table if not exists public\.financial_commitment_history/);
  assert.match(migration, /enable row level security/);
  assert.match(migration, /public\.can_edit_workspace\(workspace_id\)/);
});

test("cache cobre compromissos, planejamento, pessoas, visão e relatórios", () => {
  const cache = read("src/modules/finance/commitments-cache.ts");
  for (const token of [
    "finance:commitments:",
    "finance:planning:",
    "finance:people:",
    "finance:person:",
    "finance:overview:",
    "finance:reports:",
  ]) assert.match(cache, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});
