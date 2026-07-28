import assert from "node:assert/strict";
import test from "node:test";
import {
  resolveBillPaymentStatus,
  resolveBillReconciliationStatus,
  resolveInvoiceDisplayTotal,
  shouldAcceptIncomingInvoiceTotal,
} from "./bill-domain";

test("total oficial confiável tem prioridade e zero oficial completo é real",()=>{
  assert.deepEqual(resolveInvoiceDisplayTotal({
    providerInvoiceTotal:0,providerReliable:true,
    calculatedInvoiceTotal:100,
  }),{amount:0,source:"provider_bill",isReliable:true,isPartial:false});
});

test("Bill ausente usa cálculo e Bill parcial preserva último confiável",()=>{
  assert.deepEqual(resolveInvoiceDisplayTotal({
    providerInvoiceTotal:null,providerReliable:false,
    calculatedInvoiceTotal:250,
  }),{amount:250,source:"calculated",isReliable:true,isPartial:false});
  assert.deepEqual(resolveInvoiceDisplayTotal({
    providerInvoiceTotal:0,providerReliable:false,
    calculatedInvoiceTotal:0,calculatedReliable:false,
    lastReliableInvoiceTotal:3286.78,
    isPartial:true,
  }),{amount:3286.78,source:"last_reliable",isReliable:true,isPartial:true});
});

test("zero parcial nunca é aceito sem evidência oficial completa",()=>{
  assert.equal(shouldAcceptIncomingInvoiceTotal({
    total:0,dataCompleteness:"partial",source:"provider",
    officialBillPresent:true,accountMatches:true,cycleMatches:true,
    paginationComplete:true,itemHealthy:true,connectorAvailable:true,
  }),false);
  assert.equal(shouldAcceptIncomingInvoiceTotal({
    total:0,dataCompleteness:"complete",source:"provider",
    officialBillPresent:true,accountMatches:true,cycleMatches:true,
    paginationComplete:true,itemHealthy:true,connectorAvailable:true,
  }),true);
  assert.equal(shouldAcceptIncomingInvoiceTotal({
    total:null,dataCompleteness:"complete",source:"provider",
    officialBillPresent:true,accountMatches:true,cycleMatches:true,
  }),false);
});

test("último zero sem evidência confiável resulta indisponível",()=>{
  assert.deepEqual(resolveInvoiceDisplayTotal({
    providerInvoiceTotal:0,providerReliable:false,
    calculatedInvoiceTotal:0,calculatedReliable:false,
    lastReliableInvoiceTotal:0,lastReliableReliable:false,isPartial:true,
  }),{
    amount:null,source:"unavailable",isReliable:false,isPartial:true,
  });
});

test("pagamentos oficial integral, parcial e parcelado têm estados distintos",()=>{
  assert.equal(resolveBillPaymentStatus({
    total:11517.22,
    payments:[{valueType:"FULL_PAYMENT",amount:11517.22}],
  }).status,"paid");
  assert.equal(resolveBillPaymentStatus({
    total:100,
    payments:[{valueType:"OTHER_PAYMENT",amount:40}],
  }).status,"partially_paid");
  assert.equal(resolveBillPaymentStatus({
    total:100,
    payments:[{valueType:"INSTALLMENT_PAYMENT",amount:40}],
  }).status,"installment_payment");
});

test("conciliação distingue incompleta e itens identificados em excesso",()=>{
  assert.deepEqual(resolveBillReconciliationStatus(11517.22,9953.10),{
    status:"incomplete",difference:1564.12,
  });
  assert.deepEqual(resolveBillReconciliationStatus(100,120),{
    status:"over_identified",difference:-20,
  });
  assert.equal(resolveBillReconciliationStatus(null,0).status,"unavailable");
});
