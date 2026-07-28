import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import test from "node:test";

const migration=readFileSync(join(
  process.cwd(),
  "supabase/migrations/202607270028_official_pluggy_bills.sql",
),"utf8");

test("Bills, pagamentos e encargos usam identidade oficial idempotente",()=>{
  assert.match(migration,/add column if not exists provider_bill_id text/);
  assert.match(migration,/card_invoices_provider_identity/);
  assert.match(migration,/provider_bill_id/);
  assert.match(migration,/unique\(owner_id, provider, provider_payment_id\)/);
  assert.match(migration,/unique\(owner_id, provider, provider_charge_id\)/);
});

test("filhos da Bill herdam o escopo e permanecem protegidos por RLS",()=>{
  assert.match(migration,/enforce_official_bill_child_scope/);
  assert.match(migration,/credit_card_bill_payments enable row level security/);
  assert.match(migration,/credit_card_bill_finance_charges enable row level security/);
  assert.match(migration,/can_read_finance\(owner_id,workspace_id,visibility\)/);
});

test("pagamento vinculado é saída de caixa neutra para consumo",()=>{
  assert.match(migration,/transaction_role='invoice_payment'/);
  assert.match(migration,/bank_direction='outflow'/);
  assert.match(migration,/financial_role='cash_flow_only'/);
  assert.doesNotMatch(migration,/financial_role='invoice_payment'/);
});

test("backfill é dry-run agregado e não fixa dados reais",()=>{
  assert.match(migration,/official_bill_backfill_dry_run/);
  assert.match(migration,/'invoices_analyzed'/);
  assert.match(migration,/'ambiguities'/);
  assert.doesNotMatch(migration,/11517[.,]22|9953[.,]10|1564[.,]12/);
});

test("webhook é autenticado, idempotente e processado após a resposta",()=>{
  const route=readFileSync(join(
    process.cwd(),"src/app/api/pluggy/webhook/route.ts",
  ),"utf8");
  assert.match(route,/PLUGGY_WEBHOOK_SECRET/);
  assert.match(route,/timingSafeEqual/);
  assert.match(route,/after\(async/);
  assert.match(route,/pluggy_webhook_events/);
  assert.match(migration,/event_id text not null unique/);
});
