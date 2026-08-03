import assert from "node:assert/strict";
import test from "node:test";
import {resolveStatementDisplayAmount} from "./statement-value-policy";

test("sincronizaÃ§Ã£o completa atualiza o snapshot confiÃ¡vel",()=>{
 const value=resolveStatementDisplayAmount({
  calculatedTotalAmount:7669.72,calculationCompleteness:"complete",
  lastReliableTotalAmount:7082.45,previousDisplayTotalAmount:7082.45,
 });
 assert.equal(value.displayTotalAmount,7669.72);
 assert.equal(value.lastReliableTotalAmount,7669.72);
 assert.equal(value.source,"complete_transaction_sum");
});

test("lista parcial menor nÃ£o reduz nem zera a fatura",()=>{
 for(const calculatedTotalAmount of [7082.45,0]){
  const value=resolveStatementDisplayAmount({
   calculatedTotalAmount,calculationCompleteness:"partial",
   lastReliableTotalAmount:7669.72,previousDisplayTotalAmount:7669.72,
  });
  assert.equal(value.displayTotalAmount,7669.72);
  assert.equal(value.reason,"partial_sync_preserved");
  assert.equal(value.preserved,true);
 }
});

test("sincronizaÃ§Ã£o parcial pode incorporar nova compra",()=>{
 const value=resolveStatementDisplayAmount({
  calculatedTotalAmount:7769.72,calculationCompleteness:"partial",
  lastReliableTotalAmount:7669.72,previousDisplayTotalAmount:7669.72,
  changeReason:"new_transaction",
 });
 assert.equal(value.displayTotalAmount,7769.72);
 assert.equal(value.lastReliableTotalAmount,7669.72);
 assert.equal(value.source,"partial_estimate");
});

test("reduÃ§Ã£o parcial exige atualizaÃ§Ã£o, estorno, crÃ©dito ou exclusÃ£o",()=>{
 for(const changeReason of ["transaction_updated","transaction_deleted",
  "credit_received","refund_received"] as const){
  const value=resolveStatementDisplayAmount({
   calculatedTotalAmount:7419.72,calculationCompleteness:"partial",
   lastReliableTotalAmount:7669.72,previousDisplayTotalAmount:7669.72,
   changeReason,
  });
  assert.equal(value.displayTotalAmount,7419.72);
  assert.equal(value.reason,changeReason);
 }
});

test("Bill oficial, inclusive zero, sempre tem prioridade",()=>{
 for(const bankTotalAmount of [7512.30,0]){
  const value=resolveStatementDisplayAmount({
   bankTotalAmount,calculatedTotalAmount:5661.44,
   calculationCompleteness:"partial",lastReliableTotalAmount:7669.72,
   previousDisplayTotalAmount:7669.72,
  });
  assert.equal(value.displayTotalAmount,bankTotalAmount);
  assert.equal(value.source,"bank_bill");
 }
});

test("Bill menor não reduz snapshot durante sincronização parcial",()=>{
 const value=resolveStatementDisplayAmount({
  bankTotalAmount:7082.45,calculatedTotalAmount:7082.45,
  calculationCompleteness:"partial",lastReliableTotalAmount:7669.72,
  previousDisplayTotalAmount:7669.72,bankTotalCanReduce:false,
 });
 assert.equal(value.displayTotalAmount,7669.72);
 assert.equal(value.lastReliableTotalAmount,7669.72);
 assert.equal(value.source,"reliable_snapshot");
 assert.equal(value.reason,"partial_sync_preserved");
 assert.equal(value.preserved,true);
});

test("Bill maior continua sendo incorporada durante sincronização parcial",()=>{
 const value=resolveStatementDisplayAmount({
  bankTotalAmount:7769.72,calculationCompleteness:"partial",
  lastReliableTotalAmount:7669.72,previousDisplayTotalAmount:7669.72,
  bankTotalCanReduce:false,
 });
 assert.equal(value.displayTotalAmount,7769.72);
 assert.equal(value.source,"bank_bill");
});
