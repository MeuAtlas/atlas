import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isCronAuthorized } from "@/lib/cron-auth";
import {
  rollingOccurrenceHorizon,
} from "./commitment-occurrence-service";
import {
  generateCommitmentOccurrences,
  type FinancialCommitment,
} from "./commitments";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

const recurring: FinancialCommitment = {
  id: "00000000-0000-4000-8000-000000000001",
  workspaceId: "00000000-0000-4000-8000-000000000002",
  title: "Ginástica",
  description: null,
  commitmentType: "recurring",
  recurrenceFrequency: "monthly",
  recurrenceInterval: 1,
  amountType: "estimated",
  expectedAmountCents: 15_000,
  minimumExpectedAmountCents: null,
  maximumExpectedAmountCents: null,
  currencyCode: "BRL",
  categoryId: null,
  accountId: null,
  cardId: null,
  paymentMethod: "pix",
  dueDay: 10,
  dueDate: null,
  startDate: "2026-07-10",
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
  lastGeneratedUntil: null,
};

test("horizonte móvel termina no último dia do próximo mês", () => {
  assert.equal(rollingOccurrenceHorizon("2026-07-29"), "2026-08-31");
  assert.equal(rollingOccurrenceHorizon("2026-12-15"), "2027-01-31");
});

test("recorrência mensal mantém somente mês vigente e próximo", () => {
  const generated = generateCommitmentOccurrences({
    commitment: recurring,
    from: "2026-07-01",
    until: rollingOccurrenceHorizon("2026-07-29"),
    today: "2026-07-29",
  });
  assert.deepEqual(
    generated.map(item => item.competenceMonth),
    ["2026-07-01", "2026-08-01"],
  );
});

test("serviço remove apenas previsões distantes sem tocar em pagamentos", () => {
  const service = read(
    "src/modules/finance/commitment-occurrence-service.ts",
  );
  assert.match(service, /\.gt\("expected_due_date", until\)/);
  assert.match(
    service,
    /\.in\("status", \["projected", "expected", "pending"\]\)/,
  );
  assert.match(service, /\.is\("linked_transaction_id", null\)/);
  assert.match(service, /\.is\("linked_card_movement_id", null\)/);
});

test("pular uma ocorrência não encerra a recorrência", () => {
  const actions = read("src/modules/finance/commitments-actions.ts");
  assert.match(actions, /export async function skipCommitmentOccurrence/);
  const skipBlock = actions.slice(
    actions.indexOf("export async function skipCommitmentOccurrence"),
    actions.indexOf("export async function updateCommitmentAmount"),
  );
  assert.match(skipBlock, /status: "skipped"/);
  assert.doesNotMatch(skipBlock, /status: "completed"/);
});

test("encerrar preserva histórico e cancela somente previsões não vinculadas", () => {
  const actions = read("src/modules/finance/commitments-actions.ts");
  const block = actions.slice(
    actions.indexOf("export async function completeFinancialCommitment"),
    actions.indexOf("export async function archiveFinancialCommitment"),
  );
  assert.match(block, /complete_financial_commitment/);
  const migration = read(
    "supabase/migrations/202607290054_rolling_commitment_occurrences.sql",
  );
  assert.match(migration, /status = 'completed'/);
  assert.match(migration, /expected_due_date >= target_date/);
  assert.match(migration, /linked_transaction_id is null/);
  assert.match(migration, /linked_card_movement_id is null/);
});

test("reajuste registra vigência e não atualiza ocorrências pagas", () => {
  const actions = read("src/modules/finance/commitments-actions.ts");
  const block = actions.slice(
    actions.indexOf("export async function updateCommitmentAmount"),
    actions.indexOf("export async function updateOccurrenceStatusesAction"),
  );
  assert.match(block, /revise_financial_commitment_amount/);
  const migration = read(
    "supabase/migrations/202607290054_rolling_commitment_occurrences.sql",
  );
  assert.match(migration, /financial_commitment_amount_revisions/);
  assert.match(migration, /from_effective_date/);
  assert.match(migration, /single_occurrence/);
  assert.match(
    migration,
    /status in \('projected', 'expected', 'pending'\)/,
  );
});

test("migration cria histórico de reajustes com RLS e poda segura", () => {
  const migration = read(
    "supabase/migrations/202607290054_rolling_commitment_occurrences.sql",
  );
  assert.match(
    migration,
    /create table if not exists public\.financial_commitment_amount_revisions/,
  );
  assert.match(migration, /enable row level security/);
  assert.match(migration, /commitment_amount_revisions_read/);
  assert.match(migration, /occurrence\.status in \('projected', 'expected', 'pending'\)/);
  assert.match(migration, /occurrence\.linked_transaction_id is null/);
});

test("cron de rollover exige CRON_SECRET e está agendado", () => {
  assert.equal(
    isCronAuthorized(
      new Request("http://localhost/api/cron/commitment-rollover"),
      "secret",
    ),
    false,
  );
  assert.equal(
    isCronAuthorized(
      new Request("http://localhost/api/cron/commitment-rollover", {
        headers: { authorization: "Bearer secret" },
      }),
      "secret",
    ),
    true,
  );
  const vercel = read("vercel.json");
  assert.match(vercel, /\/api\/cron\/commitment-rollover/);
  assert.match(vercel, /"schedule": "15 3 \* \* \*"/);
});

test("interface diferencia pular, encerrar e reajustar", () => {
  const details = read(
    "src/components/finance/commitments/commitment-details.tsx",
  );
  const amountForm = read(
    "src/components/finance/commitments/commitment-amount-form.tsx",
  );
  for (const label of [
    "Pular este mês",
    "Pular próximo mês",
    "Encerrar recorrência",
    "Alterar valor",
  ]) {
    assert.match(details, new RegExp(label));
  }
  assert.match(amountForm, /Somente esta ocorrência/);
  assert.match(amountForm, /Desta ocorrência em diante/);
  assert.match(amountForm, /O que já foi pago não será modificado/);
});
