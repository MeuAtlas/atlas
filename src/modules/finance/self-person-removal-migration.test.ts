import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const migration = readFileSync(path.join(
  process.cwd(),
  "supabase/migrations/202607290055_remove_self_person_and_support_owner_allocations.sql",
), "utf8");

test("migration converte responsabilidade self em owner sem alterar valores", () => {
  assert.match(migration, /responsible_party_type text not null default 'person'/);
  assert.match(migration, /responsible_party_type = 'owner' and person_id is null/);
  assert.match(
    migration,
    /set person_id = null,\s+responsible_party_type = 'owner'/,
  );
  assert.doesNotMatch(migration, /delete from public\.financial_transactions/);
  assert.doesNotMatch(migration, /delete from public\.financial_commitments/);
  assert.doesNotMatch(migration, /delete from public\.financial_reimbursements/);
});

test("migration remove vínculos comuns, arquiva self e é idempotente", () => {
  assert.match(migration, /delete from public\.transaction_people/);
  assert.match(migration, /delete from public\.commitment_people/);
  assert.match(migration, /where relation_type = 'self'/);
  assert.match(migration, /archived_at = coalesce\(archived_at, now\(\)\)/);
  assert.match(migration, /add column if not exists is_internal/);
  assert.match(migration, /add column if not exists responsible_party_type/);
});

test("novas despesas compartilhadas usam allocation owner", () => {
  assert.match(migration, /null, 'owner', 'responsible_party'/);
  assert.doesNotMatch(
    migration,
    /select id into self_person_id from public\.financial_people/,
  );
});

test("entidades internas de matching são marcadas e pessoas self ficam inválidas", () => {
  assert.match(migration, /internal_kind = 'person_matching'/);
  assert.match(
    migration,
    /check \(relation_type <> 'self' or archived_at is not null\)/,
  );
});
