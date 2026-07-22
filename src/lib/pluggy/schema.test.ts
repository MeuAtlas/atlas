import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const migration=readFileSync(join(process.cwd(),"supabase/migrations/202607220008_create_pluggy_integration.sql"),"utf8");
const actions=readFileSync(join(process.cwd(),"src/app/financeiro/integracoes/actions.ts"),"utf8");

test("Item não pode pertencer a dois usuários",()=>assert.match(migration,/unique index[\s\S]*bank_connections\(provider, provider_connection_id\)/i));
test("tabelas Pluggy novas têm RLS",()=>{assert.match(migration,/financial_investments enable row level security/i);assert.match(migration,/financial_loans enable row level security/i);assert.match(migration,/financial_sync_runs enable row level security/i)});
test("políticas restringem dados ao usuário autenticado",()=>assert.ok((migration.match(/owner_id=auth\.uid\(\)/g)??[]).length>=3));
test("sincronização concorrente usa row lock e janela de recuperação",()=>{assert.match(migration,/for update/i);assert.match(migration,/interval '30 minutes'/i);assert.match(migration,/sync_in_progress/i)});
test("unicidade externa sustenta idempotência de todas as entidades",()=>assert.equal((migration.match(/(?:unique\s*\(|on public\.[a-z_]+\s*\()owner_id,\s*source,\s*external_id\)/gi)??[]).length,5));
test("desvincular usa RPC protegida sem excluir dados importados",()=>{assert.match(actions,/unlink_financial_connection/);assert.match(migration,/set status='disabled',sync_status='unlinked'/);assert.doesNotMatch(actions,/financial_(accounts|transactions|investments|loans)"\)\.delete/)});
