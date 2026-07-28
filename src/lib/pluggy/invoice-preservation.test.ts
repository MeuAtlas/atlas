import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import test from "node:test";
import {
  mergeInvoicePersistenceRow,
  reliableInvoiceTotal,
} from "./invoice-preservation";

const previous={
  calculated_invoice_total:3286.78,
  total_amount:3286.78,
  invoice_total:3286.78,
  purchase_count:36,
  last_reliable_invoice_total:3286.78,
  last_reliable_purchase_count:36,
  invoice_breakdown:{instrument_5718:1200},
  last_complete_sync_at:"2026-07-26T10:00:00.000Z",
};

test("sincronização parcial não troca total e compras confiáveis por zero",()=>{
  const result=mergeInvoicePersistenceRow({
    previous,
    incoming:{
      calculated_invoice_total:0,total_amount:0,invoice_total:0,
      purchase_count:0,invoice_breakdown:{},
    },
    completeness:"partial",
    reasons:["provider_warning"],
    syncedAt:"2026-07-27T10:00:00.000Z",
  });
  assert.equal(result.preserved,true);
  assert.equal(result.row.calculated_invoice_total,3286.78);
  assert.equal(result.row.purchase_count,36);
  assert.deepEqual(result.row.invoice_breakdown,{instrument_5718:1200});
  assert.equal(result.row.last_complete_sync_at,"2026-07-26T10:00:00.000Z");
  assert.match(String(result.row.preservation_reason),/purchase_count_dropped_to_zero/);
});

test("sincronização completa aceita fatura realmente zerada",()=>{
  const result=mergeInvoicePersistenceRow({
    previous,
    incoming:{
      calculated_invoice_total:0,total_amount:0,invoice_total:0,
      purchase_count:0,
    },
    completeness:"complete",
    reasons:[],
    syncedAt:"2026-07-27T10:00:00.000Z",
  });
  assert.equal(result.preserved,false);
  assert.equal(result.row.calculated_invoice_total,0);
  assert.equal(result.row.purchase_count,0);
  assert.equal(result.row.last_reliable_invoice_total,0);
  assert.equal(result.row.last_complete_sync_at,"2026-07-27T10:00:00.000Z");
});

test("prioridade do total confiável distingue null de zero",()=>{
  assert.equal(reliableInvoiceTotal({
    provider_invoice_total:null,
    manual_invoice_total:0,
    confirmed_invoice_total:25,
  }),0);
  assert.equal(reliableInvoiceTotal({
    provider_invoice_total:null,
    manual_invoice_total:null,
    confirmed_invoice_total:25,
  }),25);
});

test("materialização não deixa o ciclo anterior sobrescrever o vínculo atual",()=>{
  const sync=readFileSync(join(process.cwd(),"src/lib/pluggy/sync.ts"),"utf8");
  assert.match(sync,/const linkedPurchaseIds=new Set<string>\(\)/);
  assert.match(sync,/!linkedPurchaseIds\.has\(purchase\.id\)/);
  assert.match(sync,/batch\.forEach\(id=>linkedPurchaseIds\.add\(id\)\)/);
});

test("segunda aplicação parcial é idempotente",()=>{
  const first=mergeInvoicePersistenceRow({
    previous,
    incoming:{calculated_invoice_total:0,purchase_count:0,total_amount:0},
    completeness:"partial",
    reasons:["provider_warning"],
    syncedAt:"2026-07-27T10:00:00.000Z",
  });
  const second=mergeInvoicePersistenceRow({
    previous:first.row,
    incoming:{calculated_invoice_total:0,purchase_count:0,total_amount:0},
    completeness:"partial",
    reasons:["provider_warning"],
    syncedAt:"2026-07-27T10:00:00.000Z",
  });
  assert.equal(second.row.calculated_invoice_total,first.row.calculated_invoice_total);
  assert.equal(second.row.purchase_count,first.row.purchase_count);
  assert.equal(second.row.current_display_total,first.row.current_display_total);
});

test("parcial sem evidência não promove zero a último valor confiável",()=>{
  const result=mergeInvoicePersistenceRow({
    previous:{
      calculated_invoice_total:0,purchase_count:0,total_amount:0,
      data_completeness:"partial",last_complete_sync_at:null,
    },
    incoming:{calculated_invoice_total:0,purchase_count:0,total_amount:0},
    completeness:"partial",reasons:["provider_warning"],
    syncedAt:"2026-07-27T10:00:00.000Z",
  });
  assert.equal(result.row.last_reliable_invoice_total,null);
  assert.equal(result.row.current_display_total,null);
  assert.equal(result.row.last_reliable_purchase_count,null);
  assert.equal(result.row.purchase_count_source,"unavailable");
});

test("backfill v2 usa compras persistidas e é idempotente",()=>{
  const migration=readFileSync(join(
    process.cwd(),
    "supabase/migrations/202607270029_repair_partial_current_invoice_zero.sql",
  ),"utf8");
  assert.match(migration,/persisted_evidence/);
  assert.match(migration,/purchase_count_source='persisted_purchases_backfill'/);
  assert.match(migration,/restored_from_persisted_purchases_v2/);
  assert.match(migration,/partial_sync_without_reliable_snapshot/);
  assert.doesNotMatch(migration,/3286[.,]78|final 5718/i);
});
