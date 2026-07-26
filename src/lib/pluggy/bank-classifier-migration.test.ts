import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const migration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/202607250022_bank_classifier_v2.sql",
  ),
  "utf8",
);
const sync = readFileSync(
  join(process.cwd(), "src/lib/pluggy/sync.ts"),
  "utf8",
);

test("migration versiona, audita e reprocessa sem tocar overrides manuais", () => {
  assert.match(migration, /classification_version/);
  assert.match(migration, /bank_classifier_v2/);
  assert.match(migration, /bank_transaction_classification_audit/);
  assert.match(migration, /unique\(transaction_id,classifier_version\)/);
  assert.match(migration, /not t\.manually_confirmed/);
  assert.doesNotMatch(migration, /delete from public\.financial_transactions/i);
});

test("sincronização repetida preserva classificação e data confirmadas", () => {
  assert.match(sync, /preserveManualTransactionCorrections/);
  assert.match(sync, /filter\(row=>row\.manually_confirmed\)/);
  assert.match(sync, /user_effective_at/);
  assert.match(sync, /classification_version/);
});

