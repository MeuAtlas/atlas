import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { assessSyncCompleteness,hasInterruptedPagination,isConfirmedZero,isUnavailableProviderValue,shouldAcceptIncomingFinancialData,shouldPreservePreviousValue,shouldPreserveProviderValue } from "./resilience";

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

test("null e undefined são indisponíveis, zero só é confirmado em sync completa",()=>{
  assert.equal(isUnavailableProviderValue(null),true);
  assert.equal(isUnavailableProviderValue(undefined),true);
  assert.equal(isUnavailableProviderValue(0),false);
  assert.equal(isConfirmedZero(0,"complete"),true);
  assert.equal(isConfirmedZero(0,"partial"),false);
  assert.equal(shouldPreservePreviousValue({previous:100,incoming:0,completeness:"partial"}),true);
  assert.equal(shouldPreservePreviousValue({previous:100,incoming:0,completeness:"complete"}),false);
});

test("paginação interrompida é detectada por totalPages ou totalResults",()=>{
  assert.equal(hasInterruptedPagination({page:1,totalPages:2,received:100,hasNext:false}),true);
  assert.equal(hasInterruptedPagination({totalResults:101,received:100,hasNext:false}),true);
  assert.equal(hasInterruptedPagination({page:2,totalPages:2,totalResults:100,received:100,hasNext:false}),false);
});

test("sync de faturas invalida a rota corrente e informa preservação",()=>{
  const actions=readFileSync(
    join(process.cwd(),"src/app/financeiro/integracoes/actions.ts"),
    "utf8",
  );
  assert.match(actions,/revalidatePath\("\/financeiro\/cartoes\?view=current"\)/);
  assert.match(actions,/últimos dados confiáveis/);
  assert.match(actions,/syncCurrentInvoicesAction/);
});

test("migration protege e repara snapshot usando compras persistidas",()=>{
  const migration=readFileSync(
    join(process.cwd(),"supabase/migrations/202607270027_preserve_reliable_current_invoices.sql"),
    "utf8",
  );
  for(const field of [
    "last_reliable_invoice_total","current_display_total",
    "last_reliable_purchase_count","data_completeness",
    "last_complete_sync_at","stale_since","preservation_reason",
  ])assert.match(migration,new RegExp(field));
  assert.match(migration,/restored_from_persisted_purchases/);
  assert.doesNotMatch(migration,/3286[.,]78|purchase_count\s*=\s*36/);
});

test("decisão central bloqueia overwrite quando Item ou paginação são parciais",()=>{
  const decision=shouldAcceptIncomingFinancialData({
    itemStatus:"UPDATED",executionStatus:"PARTIAL_SUCCESS",
    connectorAvailable:true,paginationComplete:false,errorCount:1,
    previousCount:36,incomingCount:0,previousValue:3286.78,incomingValue:0,
    providerBillPresent:false,dataCompleteness:"partial",
    lastCompleteSyncAt:"2026-07-26T10:00:00Z",
  });
  assert.equal(decision.accept,false);
  assert.equal(decision.preservePrevious,true);
  assert.ok(decision.reasons.includes("pagination_incomplete"));
  assert.ok(decision.reasons.includes("value_dropped_to_zero"));
});
