import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const actions = readFileSync(
  join(process.cwd(), "src/modules/finance/actions.ts"),
  "utf8",
);
const sync = readFileSync(
  join(process.cwd(), "src/lib/pluggy/sync.ts"),
  "utf8",
);
const pluggyMigration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/202607220008_create_pluggy_integration.sql",
  ),
  "utf8",
);

const statusMutation =
  actions.match(
    /async function changeCardStatus[\s\S]*?export async function archiveCard/,
  )?.[0] ?? "";

test("arquivar e desarquivar alteram somente o status do mesmo cartão", () => {
  assert.match(statusMutation, /from\("credit_cards"\)\.update\(\{status,user_archived_at:/);
  assert.match(statusMutation, /\.eq\("id",id\)\.eq\("owner_id",user\.id\)/);
  assert.doesNotMatch(statusMutation, /\.(?:insert|delete)\(/);
  assert.doesNotMatch(statusMutation, /card_(?:purchases|invoices)/);
  assert.match(actions, /changeCardStatus\(data,"archived"\)/);
  assert.match(actions, /changeCardStatus\(data,"active"\)/);
});

test("próxima sincronização preserva status e reutiliza external_id", () => {
  assert.match(
    sync,
    /\["name","visibility","workspace_id","status","linked_account_id"\]/,
  );
  assert.match(
    pluggyMigration,
    /credit_cards_import_unique[\s\S]*credit_cards\(owner_id,\s*source,\s*external_id\)/,
  );
});
