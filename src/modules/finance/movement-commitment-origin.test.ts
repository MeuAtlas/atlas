import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

test("movimentação de origem quita o mês atual e deixa o próximo vencimento", () => {
  const actions = read("src/modules/finance/commitments-actions.ts");
  const transformBlock = actions.slice(
    actions.indexOf(
      "async function transformTransactionIntoRecurringCommitmentInternal",
    ),
    actions.indexOf(
      "export async function transformTransactionIntoRecurringCommitment",
    ),
  );
  assert.match(transformBlock, /linkTransactionToOccurrence\(link\)/);
  assert.match(transformBlock, /financial_commitments"\)\.delete\(\)/);
  assert.match(
    transformBlock,
    /A recorrência não gerou a ocorrência do pagamento original/,
  );

  const service = read(
    "src/modules/finance/commitment-occurrence-service.ts",
  );
  assert.match(service, /refreshCommitmentNextDueDate/);
  assert.match(service, /\.is\("linked_transaction_id", null\)/);
  assert.match(service, /next_due_date:/);
});

test("migration repara recorrências sem pagamento de origem vinculado", () => {
  const migration = read(
    "supabase/migrations/202607290056_reconcile_movement_commitment_origin.sql",
  );
  assert.match(migration, /commitment\.source = 'movement'/);
  assert.match(
    migration,
    /date_trunc\('month', transaction\.competence_date\)::date/,
  );
  assert.match(migration, /linked_transaction_id = source\.transaction_id/);
  assert.match(migration, /status = 'paid'/);
  assert.match(migration, /match_source = 'movement_origin'/);
  assert.match(migration, /order by occurrence\.expected_due_date asc/);
});

test("reparo legado exige um único lançamento financeiro exatamente compatível", () => {
  const migration = read(
    "supabase/migrations/202607290057_reconcile_unique_legacy_commitment_payment.sql",
  );
  assert.match(migration, /count\(\*\) over \(partition by occurrence\.id\)/);
  assert.match(migration, /candidate_count = 1/);
  assert.match(
    migration,
    /transaction\.competence_date = occurrence\.expected_due_date/,
  );
  assert.match(
    migration,
    /abs\(transaction\.amount\) = occurrence\.expected_amount/,
  );
  assert.match(migration, /transaction\.description = commitment\.description/);
  assert.match(migration, /source_record_id = source\.transaction_id/);
});

test("correção do Brisanet preserva histórico e deixa agosto como próximo mês", () => {
  const migration = read(
    "supabase/migrations/202607290058_repair_brisa_current_paid_occurrence.sql",
  );
  assert.match(migration, /competence_month < date '2026-07-01'/);
  assert.match(migration, /status = 'cancelled'/);
  assert.match(migration, /competence_month = date '2026-07-01'/);
  assert.match(migration, /actual_amount = expected_amount/);
  assert.match(migration, /status = 'paid'/);
  assert.match(migration, /next_due_date = date '2026-08-10'/);
});

test("vínculo manual informa conflito e só transfere com confirmação", () => {
  const actions = read("src/modules/finance/commitments-actions.ts");
  const movement = read("src/components/finance/movements-browser.tsx");
  const migration = read(
    "supabase/migrations/202607300063_relink_commitment_payment_safely.sql",
  );

  assert.match(actions, /p_replace_existing: replaceExisting/);
  assert.match(actions, /result\.outcome === "conflict"/);
  assert.match(actions, /previous_commitment_title/);
  assert.match(actions, /Promise<FinanceFormResult>/);
  assert.match(movement, /commitmentReplacementRequired/);
  assert.match(movement, /name="replace_existing"/);
  assert.match(movement, /Confirmar transferência/);
  assert.match(migration, /for update/);
  assert.match(migration, /existing_occurrence\.id is not null and not p_replace_existing/);
  assert.match(migration, /linked_transaction_id = null/);
  assert.match(migration, /linked_transaction_id = p_transaction_id/);
});

test("repetir o mesmo vínculo é idempotente e não gera erro fatal", () => {
  const actions = read("src/modules/finance/commitments-actions.ts");
  const migration = read(
    "supabase/migrations/202607300063_relink_commitment_payment_safely.sql",
  );

  assert.match(migration, /'already_linked'::text/);
  assert.match(actions, /result\.outcome === "already_linked"/);
  assert.match(
    actions,
    /Esta movimentação já estava vinculada\. O destino ficou memorizado para os próximos pagamentos/,
  );
  assert.doesNotMatch(
    actions,
    /updated\.error\.code === "23505"[\s\S]{0,100}Esta movimentação já está vinculada/,
  );
});
