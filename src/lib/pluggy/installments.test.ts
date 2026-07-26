import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { mergeManualInstallmentCorrection } from "./installment-merge";
import { mapCardPurchase, mapInstallmentEvidence, safeCreditTransactionDiagnostic } from "./mappers";
import { buildFutureInstallmentProjection, installmentLabel, matchesInstallmentFilter } from "@/modules/finance/installments";
import type { CardPurchase } from "@/modules/finance/types";

const transaction=(partial:Record<string,unknown>={})=>({
  id:"transaction-id",
  accountId:"credit-account",
  amount:400,
  date:"2026-07-20T00:00:00.000Z",
  description:"Notebook",
  status:"POSTED",
  ...partial,
});

test("compra à vista não recebe parcela 1 de 1",()=>{
  const row=mapCardPurchase(transaction(),"owner","connection","card");
  assert.equal(row.is_installment,false);
  assert.equal(row.installment_number,null);
  assert.equal(row.installment_count,null);
  assert.equal(row.installment_confidence,"unknown");
  assert.equal(installmentLabel(row as unknown as CardPurchase),null);
});

test("campos estruturados mapeiam parcelas 1/12, 3/12 e 12/12",()=>{
  for(const current of [1,3,12]){
    const row=mapCardPurchase(transaction({creditCardMetadata:{installmentNumber:current,totalInstallments:12,totalAmount:4800}}),"owner","connection","card");
    assert.equal(row.installment_number,current);
    assert.equal(row.installment_count,12);
    assert.equal(row.is_installment,true);
    assert.equal(row.installment_source,"provider_structured");
    assert.equal(row.installment_confidence,"confirmed");
  }
});

test("amount é a parcela e totalAmount é apenas o total da compra",()=>{
  const row=mapCardPurchase(transaction({amount:400,creditCardMetadata:{installmentNumber:3,totalInstallments:12,totalAmount:4800}}),"owner","connection","card");
  assert.equal(row.installment_amount,400);
  assert.equal(row.total_purchase_amount,4800);
});

test("descrições conservadoras reconhecem 03/12, PARC e PARCELA",()=>{
  for(const description of ["NOTEBOOK 03/12","NOTEBOOK PARC 03/12","NOTEBOOK PARCELA 3 DE 12","NOTEBOOK 03 DE 12"]){
    const evidence=mapInstallmentEvidence(transaction({description}));
    assert.deepEqual({number:evidence.number,count:evidence.count,source:evidence.source,confidence:evidence.confidence},{number:3,count:12,source:"provider_description",confidence:"inferred"});
  }
});

test("data com barra não é interpretada como parcelamento",()=>{
  const evidence=mapInstallmentEvidence(transaction({description:"COMPRA REALIZADA EM 03/12/2026"}));
  assert.equal(evidence.isInstallment,false);
  assert.equal(evidence.source,"unknown");
});

test("descrição genérica fica desconhecida sem inventar número ou aviso",()=>{
  const evidence=mapInstallmentEvidence(transaction({description:"COMPRA PARCELADA"}));
  assert.deepEqual(evidence,{isInstallment:false,number:null,count:null,totalPurchaseAmount:null,source:"unknown",confidence:"unknown"});
});

test("totalAmount diferente de amount não prova parcelamento sozinho",()=>{
  const evidence=mapInstallmentEvidence(transaction({amount:100,creditCardMetadata:{totalAmount:1200}}));
  assert.deepEqual(evidence,{isInstallment:false,number:null,count:null,totalPurchaseAmount:null,source:"unknown",confidence:"unknown"});
});

test("número com barra sem contexto não é interpretado",()=>{
  assert.equal(mapInstallmentEvidence(transaction({description:"03/12"})).isInstallment,false);
});

test("filtros distinguem à vista, parcelada, última e longa",()=>{
  const purchase={is_installment:true,installment_number:12,installment_count:12,installment_confidence:"confirmed"} as CardPurchase;
  assert.equal(matchesInstallmentFilter(purchase,"installments"),true);
  assert.equal(matchesInstallmentFilter(purchase,"last"),true);
  assert.equal(matchesInstallmentFilter(purchase,"long"),true);
  assert.equal(matchesInstallmentFilter(purchase,"cash"),false);
});

test("lista diferencia parcelamento confirmado, inferido, manual e desconhecido",()=>{
  const base={is_installment:true,installment_number:3,installment_count:12} as CardPurchase;
  assert.equal(installmentLabel({...base,installment_confidence:"confirmed"}),"Parcela 3 de 12");
  assert.equal(installmentLabel({...base,installment_confidence:"inferred"}),"Parcela 3 de 12 · identificada pela descrição");
  assert.equal(installmentLabel({...base,installment_confidence:"manual"}),"Parcela 3 de 12 · informada manualmente");
  assert.equal(installmentLabel({...base,is_installment:false,installment_number:null,installment_count:null,installment_confidence:"unknown"}),null);
});

test("correção manual nunca é substituída automaticamente pela sincronização",()=>{
  const manual={external_id:"same",installment_manually_confirmed:true,is_installment:true,installment_number:3,installment_count:10,installment_amount:50,total_amount:500,total_purchase_amount:500,installment_plan_id:null};
  const inferred={external_id:"same",installment_source:"provider_description",installment_confidence:"inferred",installment_number:4,installment_count:12};
  assert.equal(mergeManualInstallmentCorrection(inferred,manual).installment_count,10);
  const structured={...inferred,installment_source:"provider_structured",installment_confidence:"confirmed"};
  assert.equal(mergeManualInstallmentCorrection(structured,manual).installment_count,10);
  assert.equal(mergeManualInstallmentCorrection(structured,manual).installment_confidence,"manual");
});

test("projeção exige grupo seguro, ignora parcela oficial e não persiste duplicatas",()=>{
  const current={installment_plan_id:"plan",is_installment:true,installment_number:3,installment_count:6,installment_amount:400,status:"realized",installment_confidence:"confirmed",purchase_date:"2026-07-10",bill_forecast_date:"2026-07-01"} as CardPurchase;
  const official={...current,id:"future",installment_number:4,bill_forecast_date:"2026-08-01"} as CardPurchase;
  assert.deepEqual(buildFutureInstallmentProjection(current,[current,official]).map(item=>item.installmentNumber),[5,6]);
  assert.deepEqual(buildFutureInstallmentProjection({...current,installment_plan_id:null},[current]),[]);
});

test("diagnóstico sanitizado conta fontes sem expor descrições ou valores",()=>{
  const diagnostic=safeCreditTransactionDiagnostic([
    transaction({id:"one",creditCardMetadata:{installmentNumber:1,totalInstallments:12,totalAmount:4800}}),
    transaction({id:"two",description:"LOJA 03/12"}),
    transaction({id:"three",description:"PARCELAMENTO"}),
  ]);
  assert.equal(diagnostic.structuredInstallments,1);
  assert.equal(diagnostic.descriptionInstallments,1);
  assert.equal(diagnostic.withoutInstallmentInformation,1);
  assert.equal(diagnostic.withInstallmentNumber,1);
  assert.equal(diagnostic.withTotalInstallments,1);
  assert.equal(diagnostic.withTotalAmount,1);
  assert.equal("description" in diagnostic,false);
  assert.equal("amount" in diagnostic,false);
});

test("migration permite nulos à vista e mantém domínio e idempotência externa",()=>{
  const migration=readFileSync(join(process.cwd(),"supabase/migrations/202607230017_card_purchase_installment_metadata.sql"),"utf8");
  const integration=readFileSync(join(process.cwd(),"supabase/migrations/202607220010_classify_financial_movements.sql"),"utf8");
  assert.match(migration,/installment_number drop not null/);
  assert.match(migration,/provider_structured','provider_description','manual','unknown/);
  assert.match(migration,/installment_manually_confirmed boolean/);
  const states=readFileSync(join(process.cwd(),"supabase/migrations/202607230018_installment_information_states.sql"),"utf8");
  assert.match(states,/confirmed','inferred','manual','unknown/);
  assert.match(integration,/card_purchases_import_unique[\s\S]*owner_id,source,external_id/);
});
