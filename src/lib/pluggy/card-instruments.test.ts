import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
  accountCardInstrument,
  cardKindFromEvidence,
  mapCard,
  safeCreditTransactionDiagnostic,
  transactionCardInstrument,
} from "./mappers";
import { filterPurchasesByInstrument } from "@/modules/finance/card-invoices";
import type { CardPurchase } from "@/modules/finance/types";

test("duas Accounts CREDIT com IDs distintos permanecem produtos distintos", () => {
  const first=mapCard({id:"credit-a",type:"CREDIT",number:"00005718",creditData:{brand:"MASTERCARD"}},"owner","connection");
  const second=mapCard({id:"credit-b",type:"CREDIT",number:"00006579",creditData:{brand:"MASTERCARD"}},"owner","connection");
  assert.notEqual(first.external_id,second.external_id);
  assert.deepEqual([first.last_four_digits,second.last_four_digits],["5718","6579"]);
});

test("instrumentos físico e online podem compartilhar a mesma conta de fatura", () => {
  const physical=accountCardInstrument({id:"credit",type:"CREDIT",number:"5718",subtype:"physical"},"owner","card");
  const online=transactionCardInstrument({id:"tx",accountId:"credit",amount:-10,creditCardMetadata:{cardNumber:"**** **** **** 6579"}},"credit");
  assert.equal(physical?.credit_card_id,"card");
  assert.equal(physical?.card_kind,"physical");
  assert.equal(online?.cardKind,"unknown");
  assert.equal(online?.externalId,"account:credit:last4:6579");
});

test("campos de instrumento não documentados não criam associação",()=>{
  assert.equal(transactionCardInstrument({id:"tx",accountId:"credit",amount:-10,cardNumberLastFour:"6579",cardId:"card"},"credit"),null);
});

test("tipo não é inferido apenas pelo final",()=>assert.equal(cardKindFromEvidence("6579"),"unknown"));

test("ausência de identificador do instrumento fica pendente",()=>{
  assert.equal(transactionCardInstrument({id:"tx",accountId:"credit",amount:-10},"credit"),null);
});

test("diagnóstico CREDIT expõe apenas chaves, finais e contagens",()=>{
  const diagnostic=safeCreditTransactionDiagnostic([
    {id:"one",accountId:"credit",amount:10,description:"segredo",creditCardMetadata:{cardNumber:"5718",installmentNumber:1}},
    {id:"two",accountId:"credit",amount:20},
  ]);
  assert.equal(diagnostic.transactionCount,2);
  assert.equal(diagnostic.withInstrumentIdentifier,1);
  assert.equal(diagnostic.withoutInstrumentIdentifier,1);
  assert.deepEqual(diagnostic.assignedByLastFour,[{lastFour:"5718",count:1}]);
  assert.equal(JSON.stringify(diagnostic).includes("segredo"),false);
});

test("compras são filtradas pelo instrumento utilizado",()=>{
  const rows=[{id:"a",instrument_id:"instrument-a"},{id:"b",instrument_id:"instrument-b"}] as CardPurchase[];
  assert.deepEqual(filterPurchasesByInstrument(rows,"instrument-b").map(row=>row.id),["b"]);
});

test("modelo usa external_id e preserva arquivamento manual",()=>{
  const migration=readFileSync(join(process.cwd(),"supabase/migrations/202607230012_credit_card_instruments.sql"),"utf8");
  const sync=readFileSync(join(process.cwd(),"src/lib/pluggy/sync.ts"),"utf8");
  assert.match(migration,/unique\(owner_id,\s*source,\s*external_id\)/);
  assert.match(migration,/user_archived_at/);
  assert.match(sync,/\["display_name","card_kind","user_archived_at"\]/);
  assert.match(sync,/onConflict:"owner_id,source,external_id"/);
});
