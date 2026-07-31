import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const migration = readFileSync(join(
  process.cwd(),
  "supabase/migrations/202607300067_aggregate_commitment_payments_by_source.sql",
), "utf8");
const baseMigration = readFileSync(join(
  process.cwd(),
  "supabase/migrations/202607300064_income_expenses_monthly_aggregation.sql",
), "utf8");
const destinationRepair = readFileSync(join(
  process.cwd(),
  "supabase/migrations/202607300071_repair_commitment_payment_destination.sql",
), "utf8");
const privateTransactionRepair = readFileSync(join(
  process.cwd(),
  "supabase/migrations/202607300072_reconcile_private_transactions_server_side.sql",
), "utf8");
const ambiguityRepair = readFileSync(join(
  process.cwd(),
  "supabase/migrations/202607300073_disambiguate_commitment_payment_source.sql",
), "utf8");

test("vínculo manual usa a tabela canônica de múltiplos pagamentos", () => {
  assert.match(
    migration,
    /insert into public\.financial_occurrence_transactions/,
  );
  assert.match(baseMigration, /unique \(occurrence_id, transaction_id\)/);
  assert.match(migration, /on conflict \(occurrence_id, transaction_id\)/);
});

test("duas cotas são somadas e quitam o valor total esperado", () => {
  assert.match(migration, /sum\(link\.allocated_amount\)/);
  assert.match(migration, /linked_transactions_count = payment_count/);
  assert.match(migration, /paid_amount = total_paid/);
  assert.match(
    migration,
    /when total_paid >= coalesce\(target\.expected_amount, 0\) - 0\.01/,
  );
  assert.match(migration, /when total_paid > 0 then 'partially_paid'/);
});

test("repetir o mesmo vínculo é idempotente", () => {
  assert.match(baseMigration, /unique \(transaction_id\)/);
  assert.match(migration, /on conflict \(transaction_id\) do nothing/);
  assert.match(migration, /'already_linked'::text/);
});

test("destino confirmado reconhece lançamentos existentes e futuros", () => {
  assert.match(
    migration,
    /create table if not exists public\.commitment_payment_sources/,
  );
  assert.match(
    migration,
    /apply_commitment_payment_source_to_existing/,
  );
  assert.match(
    migration,
    /financial_transactions_apply_commitment_payment_sources/,
  );
  assert.match(
    migration,
    /transaction_matches_commitment_payment_source/,
  );
});

test("regra separa conta e direção e não disputa uma movimentação", () => {
  assert.match(migration, /source\.account_id is distinct from movement\.account_id/);
  assert.match(migration, /source\.direction <> coalesce\(movement\.bank_direction/);
  assert.match(
    migration,
    /commitment_payment_sources_identity_idx/,
  );
  assert.match(migration, /on conflict \(transaction_id\) do nothing/);
});

test("migration repara vínculos legados sem apagar movimentações", () => {
  assert.match(migration, /Repair transactions linked after migration 064/);
  assert.match(
    migration,
    /left join public\.financial_occurrence_transactions link/,
  );
  assert.doesNotMatch(
    migration,
    /delete from public\.financial_transactions/i,
  );
  assert.doesNotMatch(
    migration,
    /delete from public\.financial_commitment_occurrences/i,
  );
});

test("destino bancario normalizado reaplica pagamentos existentes", () => {
  assert.match(
    destinationRepair,
    /normalize_commitment_payment_identity\(p_movement\.description\)/,
  );
  assert.match(
    destinationRepair,
    /source\.account_id is not distinct from p_movement\.account_id/,
  );
  assert.match(destinationRepair, /source\.direction = 'outflow'/);
  assert.match(
    destinationRepair,
    /perform public\.apply_commitment_payment_source_to_existing\(saved_id\)/,
  );
});

test("servidor reconcilia transacao privada somente para o mesmo dono", () => {
  assert.match(privateTransactionRepair, /auth\.role\(\) = 'service_role'/);
  assert.match(
    privateTransactionRepair,
    /transaction\.owner_id = target_occurrence\.created_by/,
  );
});

test("regra SQL nao confunde parametro com alias de origem", () => {
  assert.match(
    ambiguityRepair,
    /payment_source public\.commitment_payment_sources/,
  );
  assert.match(
    ambiguityRepair,
    /payment_rule public\.commitment_payment_sources%rowtype/,
  );
  assert.doesNotMatch(ambiguityRepair, /for source in/);
});
