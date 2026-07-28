import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { chunkForUrlFilter,shouldRecoverFullHistory,SUPABASE_FILTER_BATCH_SIZE } from "./batching";
import { readPluggyConfig } from "./config-core";
import { IntegrationSyncError,PluggyApiError,PluggyError,normalizeIntegrationError,publicPluggyMessage,sanitizeDiagnostic } from "./errors";
import { ApiKeyCache } from "./key-cache";
import { classifyTransaction, cursorFromNext, findSuspectedTransferIds, mapAccount, mapCard, mapCardPurchase, mapTransaction, safeMetadata } from "./mappers";
import { classifyBankTransaction } from "./bank-classifier";

test("credenciais ausentes mantêm a integração desconfigurada",()=>assert.equal(readPluggyConfig({}).configured,false));
test("credenciais completas configuram a integração",()=>assert.equal(readPluggyConfig({PLUGGY_CLIENT_ID:"id",PLUGGY_CLIENT_SECRET:"secret"}).configured,true));
test("cache cria, reutiliza e expira API key",()=>{let now=1000;const cache=new ApiKeyCache(()=>now);cache.set("temporary",120000);assert.equal(cache.get(),"temporary");now=62001;assert.equal(cache.get(),null)});
test("cache pode ser invalidado para renovação após 401",()=>{const cache=new ApiKeyCache();cache.set("temporary");cache.clear();assert.equal(cache.get(),null)});
test("cursor é extraído de URL, query relativa ou token opaco",()=>{assert.equal(cursorFromNext("/v2/transactions?after=next-token"),"next-token");assert.equal(cursorFromNext("opaque-token"),"opaque-token");assert.equal(cursorFromNext(null),undefined)});
test("conta importada usa chave externa idempotente e metadados mínimos",()=>{const row=mapAccount({id:"acc-1",type:"BANK",subtype:"CHECKING_ACCOUNT",name:"Conta",balance:10,document:"must-not-store"},"user","connection");assert.equal(row.external_id,"acc-1");assert.deepEqual(row.provider_metadata,{type:"BANK",subtype:"CHECKING_ACCOUNT"})});
test("cartão guarda somente os quatro últimos dígitos",()=>{const row=mapCard({id:"card-1",type:"CREDIT",number:"4111111111111234",creditData:{}},"user","connection");assert.equal(row.last_four_digits,"1234");assert.equal(JSON.stringify(row).includes("4111111111111234"),false)});
test("entrada e saída bancária são classificadas pelo tipo e sentido",()=>{assert.equal(classifyTransaction({id:"1",accountId:"a",type:"CREDIT",amount:10}).transaction_type,"income");assert.equal(classifyTransaction({id:"2",accountId:"a",type:"DEBIT",amount:-10}).transaction_type,"expense")});
test("compra no cartão é despesa",()=>assert.equal(classifyTransaction({id:"1",accountId:"c",amount:30},true).transaction_type,"expense"));
test("estorno é reconhecido sem depender somente do sinal",()=>assert.equal(classifyTransaction({id:"1",accountId:"c",amount:-30,description:"Estorno compra"},true).transaction_type,"refund"));
test("pagamento de fatura não é contabilizado como consumo",()=>{const value=classifyTransaction({id:"1",accountId:"a",amount:-100,description:"Pagamento de fatura"});assert.equal(value.transaction_type,"transfer");assert.equal(value.cash_flow_kind,"invoice_payment")});
test("Pix externo usa a direção estruturada e só vira interno após conciliação",()=>{const value=classifyBankTransaction({id:"1",accountId:"a",type:"DEBIT",amount:-100,description:"PIX enviado"});assert.equal(value.transaction_type,"expense");assert.equal(value.financial_nature,"pix_sent");assert.equal(value.suspected_transfer,false);assert.equal(value.review_status,"reviewed")});
test("PIX isolado não vira transferência interna confirmada",()=>{const value=classifyBankTransaction({id:"pix",accountId:"a",type:"DEBIT",amount:-100,description:"PIX enviado"});assert.equal(value.transaction_role,"cash_flow");assert.equal(value.financial_role,"expense")});
test("tarifa bancária e encargo de cartão são despesas",()=>{const bank=classifyTransaction({id:"fee",accountId:"a",amount:-20,description:"Tarifa bancária"});const card=classifyTransaction({id:"card-fee",accountId:"c",amount:-15,description:"Encargo"},true);assert.equal(bank.transaction_role,"cash_flow");assert.equal(bank.transaction_type,"expense");assert.equal(card.transaction_role,"consumption")});
test("empréstimo recebido e principal de investimento têm natureza não operacional",()=>{const loan=classifyTransaction({id:"loan",accountId:"a",amount:20000,description:"Crédito empréstimo"});const investment=classifyTransaction({id:"investment",accountId:"a",amount:-5000,description:"Aplicação investimento"});assert.equal(loan.cash_flow_kind,"loan_proceeds");assert.equal(investment.cash_flow_kind,"investment_contribution")});
test("detecção conservadora exige valor, sentidos, contas, data e descrição compatíveis",()=>{const ids=findSuspectedTransferIds([{id:"a",accountId:"1",amount:50,direction:"out",date:"2026-01-10",description:"PIX"},{id:"b",accountId:"2",amount:50,direction:"in",date:"2026-01-11",description:"Transferência recebida"},{id:"c",accountId:"2",amount:60,direction:"in",date:"2026-01-11",description:"PIX"}]);assert.deepEqual([...ids].sort(),["a","b"])});
test("mapper mantém valores internos positivos e sinal original",()=>{const row=mapTransaction({id:"tx",accountId:"a",amount:-42,date:"2026-01-01",type:"DEBIT"},"user","connection",{accountId:"local",isCreditCard:false});assert.equal(row.amount,42);assert.equal(row.original_amount,-42);assert.equal(row.external_id,"tx")});
test("compra internacional Pluggy preserva USD e usa o valor convertido em BRL",()=>{
  const row=mapCardPurchase({
    id:"foreign-card",
    accountId:"provider-card",
    description:"GITHUB",
    amount:12.2,
    amountInAccountCurrency:65.62,
    currencyCode:"USD",
    date:"2026-06-15",
  },"user","connection","card");
  assert.equal(row.installment_amount,65.62);
  assert.equal(row.amount_brl,65.62);
  assert.equal(row.original_amount,12.2);
  assert.equal(row.original_currency_code,"USD");
  assert.equal(row.provider_signed_amount,12.2);
  assert.equal(row.conversion_source,"pluggy");
  assert.equal(row.provider_metadata.amountInAccountCurrency,65.62);
});
test("Pluggy sem valor convertido nÃ£o promove USD para amount_brl",()=>{
  const row=mapCardPurchase({
    id:"foreign-without-conversion",
    accountId:"provider-card",
    description:"GITHUB",
    amount:12.2,
    currencyCode:"USD",
    date:"2026-07-15",
  },"user","connection","card");
  assert.equal(row.amount_brl,null);
  assert.equal(row.installment_amount,12.2);
  assert.equal(row.original_amount,12.2);
  assert.equal(row.conversion_source,"unknown");
});
test("IOF no exterior Ã© persistido como taxa separada",()=>{
  const row=mapCardPurchase({
    id:"foreign-iof",
    accountId:"provider-card",
    description:"IOF DESPESA NO EXTERIOR",
    amount:2.3,
    currencyCode:"BRL",
    date:"2026-07-15",
  },"user","connection","card");
  assert.equal(row.amount_brl,2.3);
  assert.equal(row.original_amount,null);
  assert.equal(row.original_currency_code,null);
  assert.equal(row.entry_type,"tax");
  assert.equal(row.transaction_role,"foreign_transaction_tax");
});
test("estorno internacional conserva o sinal do provedor sem tornar o total negativo",()=>{
  const row=mapCardPurchase({
    id:"foreign-refund",
    accountId:"provider-card",
    description:"ESTORNO GITHUB",
    amount:-12.2,
    amountInAccountCurrency:-65.62,
    currencyCode:"USD",
    date:"2026-06-16",
  },"user","connection","card");
  assert.equal(row.amount_brl,65.62);
  assert.equal(row.original_amount,12.2);
  assert.equal(row.provider_signed_amount,-12.2);
});
test("erro público nunca inclui mensagem ou segredo do provedor",()=>{const error=new PluggyError("clientSecret=private","pluggy_auth_failed",401);const message=publicPluggyMessage(error);assert.equal(message.includes("private"),false);assert.match(message,/autenticar/i)});
test("sanitização descarta payload bancário bruto",()=>assert.deepEqual(safeMetadata({status:"UPDATED",balance:999,description:"private",providerId:"safe-id"}),{status:"UPDATED",providerId:"safe-id"}));
test("normalização preserva stage, operação, status, código e causa",()=>{const cause=new PluggyApiError("Parâmetro inválido",{code:"INVALID_PARAMETER",status:422,operation:"GET /v2/transactions"});const error=new IntegrationSyncError("Falha ao importar movimentações.",{stage:"transactions_fetch",cause,code:cause.code,status:cause.status,operation:cause.operation});assert.deepEqual(normalizeIntegrationError(error),{name:"IntegrationSyncError",message:"Falha ao importar movimentações.",code:"INVALID_PARAMETER",status:422,operation:"GET /v2/transactions",stage:"transactions_fetch",causeMessage:"Parâmetro inválido",stack:undefined})});
test("diagnóstico mascara credenciais, UUID e linha SQL",()=>{const safe=sanitizeDiagnostic("clientSecret=hidden 57dd1234-1234-1234-1234-abcdef126006 Failing row contains (private data).");assert.equal(safe?.includes("hidden"),false);assert.equal(safe?.includes("private data"),false);assert.match(safe??"",/57dd…6006/)});
test("IDs usados em filtros PostgREST são divididos abaixo do limite de URL",()=>{const batches=chunkForUrlFilter(Array.from({length:251},(_,index)=>`00000000-0000-0000-0000-${String(index).padStart(12,"0")}`));assert.equal(SUPABASE_FILTER_BATCH_SIZE,100);assert.deepEqual(batches.map(batch=>batch.length),[100,100,51]);assert.ok(batches.every(batch=>encodeURIComponent(batch.join(",")).length<8000))});
test("warning de transações força recuperação completa até existir full posterior",()=>{const warning={mode:"incremental",status:"completed_with_warnings",started_at:"2026-07-22T10:00:00Z"};assert.equal(shouldRecoverFullHistory([warning]),true);assert.equal(shouldRecoverFullHistory([{mode:"full",status:"completed",started_at:"2026-07-22T11:00:00Z"},warning]),false)});
test("sincronização consome o cursor até a última página e persiste diagnóstico por cartão",()=>{const sync=readFileSync(join(process.cwd(),"src/lib/pluggy/sync.ts"),"utf8");assert.match(sync,/do\{[\s\S]*getPluggyTransactions\(account\.id,after,dateFrom\)[\s\S]*after=cursorFromNext\(page\.next\)[\s\S]*\}while\(after\)/);assert.match(sync,/credit_card_sync_diagnostics/);assert.match(sync,/received_from_pluggy:state\.received/);assert.match(sync,/persisted:persistedRows\.length/);assert.match(sync,/included_in_invoice:inclusion\.includedCount/)});
