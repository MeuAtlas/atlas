import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { assessSyncCompleteness,shouldPreserveProviderValue } from "./resilience";

const complete={creditAccounts:2,cards:2,transactions:40,bills:2,instruments:3};

test("conector indisponível produz sincronização parcial",()=>{
  const result=assessSyncCompleteness({previous:complete,current:complete,full:true,warningCount:0,transactionFailures:0,itemStatus:"OUTDATED"});
  assert.equal(result.completeness,"partial");
  assert.ok(result.reasons.includes("provider_item_unavailable"));
});

test("cartão antes populado que retorna vazio é parcial",()=>{
  const result=assessSyncCompleteness({previous:complete,current:{...complete,transactions:0},full:true,warningCount:0,transactionFailures:0,itemStatus:"UPDATED"});
  assert.ok(result.reasons.includes("previously_populated_card_empty"));
  assert.ok(result.reasons.includes("abrupt_transaction_drop"));
});

test("fatura oficial que desaparece temporariamente é parcial",()=>{
  const result=assessSyncCompleteness({previous:complete,current:{...complete,bills:1},full:true,warningCount:0,transactionFailures:0,itemStatus:"UPDATED"});
  assert.ok(result.reasons.includes("official_bill_missing"));
});

test("ausência parcial preserva último valor confiável",()=>{
  assert.equal(shouldPreserveProviderValue(6007.21,null,true),true);
  assert.equal(shouldPreserveProviderValue(6007.21,0,true),true);
  assert.equal(shouldPreserveProviderValue(6007.21,0,false),false);
});

test("recuperação completa normaliza o estado",()=>{
  const result=assessSyncCompleteness({previous:complete,current:complete,full:true,warningCount:0,transactionFailures:0,itemStatus:"UPDATED"});
  assert.deepEqual(result,{completeness:"complete",reasons:[],partialDataCount:0});
});

test("ausências do provedor não geram exclusão nem indisponibilização preventiva",()=>{
  const sync=readFileSync(join(process.cwd(),"src/lib/pluggy/sync.ts"),"utf8");
  assert.doesNotMatch(sync,/staleCards|staleAccounts|financial_loans\.mark_stale/);
  assert.doesNotMatch(sync,/\.from\("card_purchases"\)\.delete/);
  assert.match(sync,/preserveWhenMissing[\s\S]*provider_invoice_total/);
});

test("migration registra última sincronização confiável e estado parcial",()=>{
  const migration=readFileSync(join(process.cwd(),"supabase/migrations/202607230019_provider_resilience.sql"),"utf8");
  for(const field of ["last_complete_sync_at","provider_status","data_completeness","incident_message","stale_since","partial_data_count","last_complete_counts"])assert.match(migration,new RegExp(field));
  assert.match(migration,/completed_with_warnings/);
});

test("avaliação repetida é idempotente",()=>{
  const input={previous:complete,current:complete,full:true,warningCount:0,transactionFailures:0,itemStatus:"UPDATED"};
  assert.deepEqual(assessSyncCompleteness(input),assessSyncCompleteness(input));
});
