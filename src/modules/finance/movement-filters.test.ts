import assert from "node:assert/strict";
import test from "node:test";
import { matchesCardPurchase,matchesTransaction,movementKind } from "./movement-filters";
import type { CardPurchase,FinancialTransaction } from "./types";
const tx={id:"bank",description:"PIX",amount:20,transaction_type:"expense",transaction_role:"cash_flow",source_type:"bank",financial_origin:"bank_account",status:"realized",competence_date:"2026-07-01",due_date:null,realized_at:null,source:"pluggy",visibility:"private",account_id:"account-a",destination_account_id:null,category_id:null,workspace_id:null} as FinancialTransaction;
const card={id:"purchase",card_id:"card-a",invoice_id:null,description:"Compra",total_amount:100,installment_amount:10,purchase_date:"2026-07-02",installment_number:3,installment_count:10,source:"pluggy",source_type:"card",financial_origin:"credit_card",transaction_role:"consumption",status:"realized",review_status:"reviewed",invoice_reference:"bill",bill_forecast_date:null,provider_category:null,merchant:null,visibility:"private",category_id:null} as CardPurchase;
test("filtro por conta aceita somente a conta selecionada",()=>{assert.equal(matchesTransaction(tx,{account:"account-a"}),true);assert.equal(matchesTransaction(tx,{account:"account-b"}),false)});
test("filtro por cartao aceita somente o cartao selecionado",()=>{assert.equal(matchesCardPurchase(card,{card:"card-a"}),true);assert.equal(matchesCardPurchase(card,{card:"card-b"}),false)});
test("compra de cartao e transacao bancaria ficam em grupos diferentes",()=>{assert.equal(movementKind(tx),"bank");assert.equal(movementKind(card),"card")});
