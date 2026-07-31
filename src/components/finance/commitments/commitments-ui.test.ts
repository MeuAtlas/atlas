import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const component = readFileSync(
  join(root, "src/components/finance/commitments/commitments-workspace.tsx"),
  "utf8",
);
const commitmentForm = readFileSync(
  join(root, "src/components/finance/commitments/commitment-form.tsx"),
  "utf8",
);
const movement = readFileSync(
  join(root, "src/components/finance/movements-browser.tsx"),
  "utf8",
);
const actions = readFileSync(
  join(root, "src/modules/finance/commitments-actions.ts"),
  "utf8",
);
const planning = readFileSync(
  join(root, "src/app/financeiro/planejamento/page.tsx"),
  "utf8",
);
const migration = readFileSync(
  join(root, "supabase/migrations/202607280039_create_financial_commitments.sql"),
  "utf8",
);
const hardening = readFileSync(
  join(root, "supabase/migrations/202607280040_harden_financial_commitment_scope.sql"),
  "utf8",
);
const query = readFileSync(
  join(root, "src/modules/finance/commitments-query.ts"),
  "utf8",
);
const styles = readFileSync(
  join(root, "src/app/globals.css"),
  "utf8",
);

test("Compromissos possui três abas, estados vazios e cadastro em formulário único", () => {
  for (const label of ["Visão geral", "Recorrentes", "Pessoas e dependentes"]) {
    assert.match(component, new RegExp(label));
  }
  assert.doesNotMatch(commitmentForm, /Etapa \{step\} de 5/);
  for (const block of [
    "Informações principais",
    "Regras e vínculos",
    "Projeção",
  ]) {
    assert.match(commitmentForm, new RegExp(block));
  }
  assert.match(commitmentForm, /FormErrorSummary/);
  assert.match(commitmentForm, /projection_confirmation/);
  assert.match(component, /Nenhuma conta recorrente cadastrada/);
  assert.match(component, /Nenhuma pessoa cadastrada/);
});

test("drawer de movimentação integra compromisso, pessoa e transformação", () => {
  assert.match(movement, /Pessoas e compromissos/);
  assert.match(movement, /linkTransactionToOccurrence/);
  assert.match(movement, /linkCardMovementToOccurrence/);
  assert.match(movement, /linkMovementSourceToPersonAction/);
  assert.match(movement, /somente a esta movimentação/);
  assert.doesNotMatch(movement, /Esta e outras semelhantes/);
  assert.match(movement, /transformTransactionIntoRecurringCommitment/);
});

test("transformação recorrente gera projeções sem confirmação técnica", () => {
  assert.doesNotMatch(movement, /name="projection_confirmation"/);
  assert.doesNotMatch(movement, /fieldErrors\.projection_confirmation/);
  assert.match(actions, /transformTransactionIntoRecurringCommitmentInternal/);
  assert.match(actions, /adapted\.set\("generates_future_projections", "true"\)/);
  assert.match(actions, /adapted\.set\("projection_confirmation", "true"\)/);
  assert.match(actions, /Promise<FinanceFormResult>/);
  assert.match(actions, /friendlyActionFailure/);
  assert.match(actions, /bank_direction === "inflow" \? "income" : "expense"/);
});

test("Planejamento usa o serviço consolidado e exibe todas as origens", () => {
  assert.match(planning, /getMonthlyFinancialCommitments/);
  for (const label of ["Recorrentes", "Parcelas", "Empréstimos", "Folha", "Únicos"]) {
    assert.match(planning, new RegExp(label));
  }
});

test("migration ativa RLS, índices e constraints de escopo", () => {
  for (const table of [
    "financial_people",
    "financial_commitments",
    "financial_commitment_occurrences",
    "commitment_people",
    "transaction_people",
    "commitment_match_rules",
  ]) {
    assert.match(migration, new RegExp(`alter table public\\.%I enable row level security|${table}_read|${table}`));
  }
  assert.match(migration, /unique \(commitment_id, competence_month, sequence_number\)/);
  assert.match(hardening, /person workspace mismatch/);
  assert.match(hardening, /transaction allocation access denied/);
});

test("compromissos arquivados preservam histórico sem contaminar os totais", () => {
  assert.match(query, /visibleCommitmentIds/);
  assert.match(
    query,
    /visibleCommitmentIds\.has\(item\.commitmentId\)/,
  );
});

test("modal preserva a altura dos blocos e permite rolagem dos campos", () => {
  assert.match(styles, /grid-auto-rows:max-content/);
  assert.match(styles, /align-content:start/);
  assert.match(
    styles,
    /\.commitment-toggle\{display:grid;grid-template-columns:34px minmax\(0,1fr\)/,
  );
});

test("cadastro suporta pensão debitada diretamente da folha", () => {
  assert.match(commitmentForm, /value="payroll">Desconto em folha/);
  assert.match(
    commitmentForm,
    /paymentMethod === "payroll" \? "payroll_deduction" : "recurring"/,
  );
  assert.match(commitmentForm, /disabled=\{paymentMethod === "payroll"\}/);
});
