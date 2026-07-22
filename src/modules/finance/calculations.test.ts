import assert from "node:assert/strict";
import test from "node:test";
import { summarizeFinance } from "./calculations";
import type { FinancialAccount, FinancialTransaction } from "./types";
const account={id:"a",name:"Conta",institution_name:null,account_type:"checking",current_balance:1000,opening_balance:0,source:"manual",status:"active",visibility:"private",last_sync_at:null} satisfies FinancialAccount;
const tx=(partial:Partial<FinancialTransaction>):FinancialTransaction=>({id:crypto.randomUUID(),description:"x",amount:100,transaction_type:"expense",status:"realized",competence_date:"2026-07-01",due_date:null,realized_at:null,source:"manual",visibility:"private",account_id:"a",destination_account_id:null,category_id:null,workspace_id:null,...partial});
test("calcula resultado e ignora transferências",()=>{const s=summarizeFinance([account],[tx({transaction_type:"income",amount:500}),tx({amount:120}),tx({transaction_type:"transfer",amount:900})],new Date("2026-07-22T12:00:00Z"));assert.equal(s.monthlyResult,380);assert.equal(s.available,1000)});
test("projeta previstos e identifica vencidos",()=>{const s=summarizeFinance([account],[tx({transaction_type:"income",status:"forecast",amount:300,due_date:"2026-07-25"}),tx({status:"pending",amount:80,due_date:"2026-07-10"})],new Date("2026-07-22T12:00:00Z"));assert.equal(s.projected,1220);assert.equal(s.overdue,80)});
