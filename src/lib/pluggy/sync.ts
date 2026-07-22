import "server-only";
import { chunkForUrlFilter,shouldRecoverFullHistory } from "./batching";
import { getPluggyAccounts,getPluggyInvestments,getPluggyItem,getPluggyLoans,getPluggyTransactions } from "./client";
import { databaseFailure,logIntegrationFailure,maskId } from "./diagnostics";
import { IntegrationSyncError,PluggyApiError,normalizeIntegrationError,sanitizeDiagnostic } from "./errors";
import { cursorFromNext,findSuspectedTransferIds,mapAccount,mapCard,mapInvestment,mapLoan,mapTransaction } from "./mappers";
import type { PluggyAccount,PluggyPage } from "./types";

type DbClient=Awaited<ReturnType<typeof import("@/lib/supabase/server").createClient>>;
type SyncStage="connection_load"|"sync_run_begin"|"auth"|"item"|"accounts_fetch"|"accounts_upsert"|"cards_fetch"|"cards_upsert"|"transactions_fetch"|"transactions_map"|"transactions_upsert"|"investments_fetch"|"investments_upsert"|"loans_fetch"|"loans_upsert"|"connection_update"|"sync_run_finalize";
type Counts={accounts:number;cards:number;transactions:number;investments:number;loans:number;pages:number;accountsCreated:number;accountsUpdated:number;cardsCreated:number;cardsUpdated:number;transactionsCreated:number;transactionsUpdated:number;transactionsSkipped:number;transactionFailures:number;investmentsCreated:number;investmentsUpdated:number;loansCreated:number;loansUpdated:number};
const emptyCounts=():Counts=>({accounts:0,cards:0,transactions:0,investments:0,loans:0,pages:0,accountsCreated:0,accountsUpdated:0,cardsCreated:0,cardsUpdated:0,transactionsCreated:0,transactionsUpdated:0,transactionsSkipped:0,transactionFailures:0,investmentsCreated:0,investmentsUpdated:0,loansCreated:0,loansUpdated:0});
// O filtro PostgREST `.in()` viaja na URL. Cem UUIDs mantêm a query bem abaixo
// do limite de 16 KB observado no proxy/Undici, enquanto o upsert segue em lotes.
const chunks=chunkForUrlFilter;

function list<T>(value:T[]|PluggyPage<T>,stage:SyncStage){
 if(Array.isArray(value))return value;
 if(value&&typeof value==="object"&&Array.isArray(value.results))return value.results;
 throw new IntegrationSyncError("A Pluggy retornou uma lista em formato inesperado.",{operation:"response.parse",stage});
}

function wrap(error:unknown,stage:SyncStage,message:string,operation="sync"){
 if(error instanceof IntegrationSyncError)return error;
 const normalized=normalizeIntegrationError(error);
 return new IntegrationSyncError(message,{code:normalized.code,status:normalized.status,operation:normalized.operation??operation,stage,cause:error});
}

async function upsertMany(supabase:DbClient,table:string,rows:Record<string,unknown>[],stage:SyncStage,preserve:string[]=[]){
 let created=0,updated=0;
 for(const batch of chunks(rows)){
  if(!batch.length)continue;
  const ownerId=String(batch[0].owner_id);const ids=batch.map(row=>String(row.external_id));
  const existing=await supabase.from(table).select(["external_id",...preserve].join(",")).eq("owner_id",ownerId).eq("source","pluggy").in("external_id",ids);
  if(existing.error)databaseFailure(existing.error,stage,`${table}.select_existing`);
  const existingRows=(existing.data??[]) as unknown as Record<string,unknown>[];const previous=new Map(existingRows.map(row=>[String(row.external_id),row]));
  updated+=existingRows.length;created+=batch.length-existingRows.length;
  const safeRows=preserve.length?batch.map(row=>{const old=previous.get(String(row.external_id));return old?{...row,...Object.fromEntries(preserve.map(key=>[key,old[key]]))}:row}):batch;
  const result=await supabase.from(table).upsert(safeRows,{onConflict:"owner_id,source,external_id"});
  if(result.error)databaseFailure(result.error,stage,`${table}.upsert`);
 }
 return {created,updated};
}

async function targetMap(supabase:DbClient,table:"financial_accounts"|"credit_cards",userId:string,externalIds:string[],stage:SyncStage){
 if(!externalIds.length)return new Map<string,string>();
 const result=await supabase.from(table).select("id,external_id").eq("owner_id",userId).eq("source","pluggy").in("external_id",externalIds);
 if(result.error)databaseFailure(result.error,stage,table);
 return new Map((result.data??[]).map(row=>[String(row.external_id),String(row.id)]));
}

function optionalWarning(error:unknown,context:{stage:SyncStage;started:number;userId:string;itemId:string},fallback:string){
 const normalized=logIntegrationFailure(error,{operation:"sync.optional",stage:context.stage,durationMs:Date.now()-context.started,user:context.userId,item:context.itemId,label:"[Atlas Pluggy Optional Stage Failure]"});
 return `${fallback}${normalized.code?` (${normalized.code})`:""}`;
}

export async function syncPluggyItem(supabase:DbClient,userId:string,connectionId:string,full=false){
 const started=Date.now();let currentStage:SyncStage="connection_load";let itemId="unknown";let runId:string|null=null;
 const counts=emptyCounts();const warnings:string[]=[];const transferCandidates:{id:string;accountId:string;amount:number;direction:"in"|"out";date:string;description:string}[]=[];
 try{
  const connection=await supabase.from("bank_connections").select("id,provider_connection_id,status,last_successful_sync_at").eq("id",connectionId).eq("owner_id",userId).eq("provider","pluggy").single();
  if(connection.error)databaseFailure(connection.error,currentStage,"bank_connections");
  if(!connection.data)throw new IntegrationSyncError("Conexão Pluggy não encontrada.",{code:"connection_not_found",stage:currentStage});
  if(connection.data.status==="disabled")throw new IntegrationSyncError("Esta conexão foi removida.",{code:"connection_disabled",stage:currentStage});
  itemId=String(connection.data.provider_connection_id);

  let effectiveFull=full;
  if(!full){
   const history=await supabase.from("financial_sync_runs").select("mode,status,started_at").eq("owner_id",userId).eq("bank_connection_id",connectionId).order("started_at",{ascending:false}).limit(50);
   if(history.error)databaseFailure(history.error,currentStage,"financial_sync_runs.recovery_check");
   effectiveFull=shouldRecoverFullHistory((history.data??[]).map(run=>({mode:String(run.mode),status:String(run.status),started_at:String(run.started_at)})));
  }

  currentStage="sync_run_begin";
  const begin=await supabase.rpc("begin_financial_sync",{target_connection:connectionId,full_sync:effectiveFull});
  if(begin.error)databaseFailure(begin.error,currentStage,"rpc:begin_financial_sync");
  runId=String(begin.data);
  const lastSuccess=connection.data.last_successful_sync_at?new Date(String(connection.data.last_successful_sync_at)):null;
  const dateFrom=!effectiveFull&&lastSuccess&&!Number.isNaN(lastSuccess.valueOf())?new Date(lastSuccess.valueOf()-3*24*60*60*1000).toISOString().slice(0,10):undefined;

  currentStage="auth"; // A autenticação acontece internamente antes da primeira consulta.
  let item:Awaited<ReturnType<typeof getPluggyItem>>;
  try{item=await getPluggyItem(itemId)}catch(error){const normalized=normalizeIntegrationError(error);currentStage=normalized.operation==="POST /auth"?"auth":"item";throw error}
  currentStage="accounts_fetch";const providerAccounts=list(await getPluggyAccounts(itemId) as PluggyAccount[]|PluggyPage<PluggyAccount>,currentStage);
  const bankAccounts=providerAccounts.filter(account=>String(account.type).toUpperCase()!=="CREDIT");const cardAccounts=providerAccounts.filter(account=>String(account.type).toUpperCase()==="CREDIT");

  currentStage="accounts_upsert";
  const staleAccounts=await supabase.from("financial_accounts").update({provider_status:"unavailable"}).eq("owner_id",userId).eq("bank_connection_id",connectionId).eq("source","pluggy");if(staleAccounts.error)databaseFailure(staleAccounts.error,currentStage,"financial_accounts");
  const institution=item.connector?.name??null;
  const accountChanges=await upsertMany(supabase,"financial_accounts",bankAccounts.map(account=>({...mapAccount(account,userId,connectionId),institution_name:institution})),currentStage,["name","account_type","visibility","workspace_id","status","color","icon","opening_balance"]);
  counts.accounts=bankAccounts.length;counts.accountsCreated=accountChanges.created;counts.accountsUpdated=accountChanges.updated;
  const accountMap=await targetMap(supabase,"financial_accounts",userId,bankAccounts.map(account=>account.id),currentStage);

  let cardMap=new Map<string,string>();
  try{
   currentStage="cards_upsert";const staleCards=await supabase.from("credit_cards").update({provider_status:"unavailable"}).eq("owner_id",userId).eq("bank_connection_id",connectionId).eq("source","pluggy");if(staleCards.error)databaseFailure(staleCards.error,currentStage,"credit_cards");
   const cardChanges=await upsertMany(supabase,"credit_cards",cardAccounts.map(account=>({...mapCard(account,userId,connectionId),institution_name:institution})),currentStage,["name","visibility","workspace_id","status","linked_account_id"]);
   counts.cards=cardAccounts.length;counts.cardsCreated=cardChanges.created;counts.cardsUpdated=cardChanges.updated;cardMap=await targetMap(supabase,"credit_cards",userId,cardAccounts.map(account=>account.id),currentStage);
  }catch(error){warnings.push(optionalWarning(wrap(error,currentStage,"Falha ao importar cartões."),{stage:currentStage,started,userId,itemId},"Cartões não puderam ser atualizados."))}

  for(const account of providerAccounts){
   const isCreditCard=String(account.type).toUpperCase()==="CREDIT";
   if(isCreditCard&&!cardMap.has(account.id)){warnings.push("Transações de um cartão foram ignoradas porque o cartão não pôde ser persistido.");continue}
   try{
    let after:string|undefined;let pageGuard=0;
    do{
     currentStage="transactions_fetch";const page=await getPluggyTransactions(account.id,after,dateFrom);const rawTransactions=list(page,currentStage);const transactions=rawTransactions.filter(transaction=>Math.abs(Number(transaction.amount??0))>0);counts.transactionsSkipped+=rawTransactions.length-transactions.length;
     currentStage="transactions_map";const target=isCreditCard?{cardId:cardMap.get(account.id),isCreditCard:true}:{accountId:accountMap.get(account.id),isCreditCard:false};
     if((isCreditCard&&!target.cardId)||(!isCreditCard&&!target.accountId))throw new IntegrationSyncError("Conta importada sem destino local.",{code:"local_target_missing",stage:currentStage});
     const rows=transactions.map(transaction=>mapTransaction(transaction,userId,connectionId,target));
     currentStage="transactions_upsert";const changes=await upsertMany(supabase,"financial_transactions",rows,currentStage);counts.transactionsCreated+=changes.created;counts.transactionsUpdated+=changes.updated;
     if(!isCreditCard)for(const transaction of transactions)transferCandidates.push({id:transaction.id,accountId:account.id,amount:Math.abs(Number(transaction.amount??0)),direction:String(transaction.type).toUpperCase()==="CREDIT"||Number(transaction.amount??0)>0?"in":"out",date:String(transaction.date??""),description:String(transaction.description??"")});
     counts.transactions+=transactions.length;counts.pages++;after=cursorFromNext(page.next);pageGuard++;
     if(pageGuard>=200)throw new IntegrationSyncError("A paginação de transações excedeu o limite de segurança.",{code:"pluggy_pagination_limit",stage:currentStage});
    }while(after);
   }catch(error){counts.transactionFailures++;warnings.push(optionalWarning(wrap(error,currentStage,"Falha ao importar movimentações."),{stage:currentStage,started,userId,itemId},"Movimentações de uma conta não puderam ser atualizadas."))}
  }

  try{currentStage="transactions_upsert";const suspected=[...findSuspectedTransferIds(transferCandidates)];for(const batch of chunks(suspected)){const result=await supabase.from("financial_transactions").update({suspected_transfer:true,review_status:"pending"}).eq("owner_id",userId).eq("source","pluggy").in("external_id",batch);if(result.error)databaseFailure(result.error,currentStage,"financial_transactions")}}
  catch(error){warnings.push(optionalWarning(wrap(error,currentStage,"Falha ao marcar possíveis transferências."),{stage:currentStage,started,userId,itemId},"Possíveis transferências aguardam nova análise."))}

  try{for(let pageNumber=1;pageNumber<=100;pageNumber++){currentStage="investments_fetch";const page=await getPluggyInvestments(itemId,pageNumber);const rows=list(page,currentStage);currentStage="investments_upsert";const changes=await upsertMany(supabase,"financial_investments",rows.map(row=>mapInvestment(row,userId,connectionId)),currentStage,["name","visibility","workspace_id"]);counts.investmentsCreated+=changes.created;counts.investmentsUpdated+=changes.updated;counts.investments+=rows.length;counts.pages++;if(!rows.length||rows.length<500||(page.totalPages&&pageNumber>=page.totalPages))break}}
  catch(error){const unavailable=error instanceof PluggyApiError&&[403,404].includes(error.status??0);warnings.push(optionalWarning(wrap(error,currentStage,"Falha ao importar investimentos."),{stage:currentStage,started,userId,itemId},unavailable?"Investimentos indisponíveis para este conector.":"Investimentos não puderam ser atualizados."))}

  try{currentStage="loans_fetch";const rows=list(await getPluggyLoans(itemId),currentStage);currentStage="loans_upsert";const changes=await upsertMany(supabase,"financial_loans",rows.map(row=>mapLoan(row,userId,connectionId)),currentStage,["name","visibility","workspace_id"]);counts.loansCreated+=changes.created;counts.loansUpdated+=changes.updated;counts.loans+=rows.length}
  catch(error){const unavailable=error instanceof PluggyApiError&&[403,404].includes(error.status??0);warnings.push(optionalWarning(wrap(error,currentStage,"Falha ao importar empréstimos."),{stage:currentStage,started,userId,itemId},unavailable?"Empréstimos indisponíveis para este conector.":"Empréstimos não puderam ser atualizados."))}

  currentStage="connection_update";const update=await supabase.from("bank_connections").update({connector_name:item.connector?.name??null,last_provider_update_at:item.updatedAt??null,sync_cursor:{lastWindowStart:dateFrom??null},metadata:{itemStatus:item.status??null}}).eq("id",connectionId).eq("owner_id",userId);if(update.error)databaseFailure(update.error,currentStage,"bank_connections");
  currentStage="sync_run_finalize";const finalStatus=warnings.length?"completed_with_warnings":"completed";const finish=await supabase.rpc("finish_financial_sync",{target_run:runId,final_status:finalStatus,counters:counts,failure_code:warnings.length?"partial_coverage":null,failure_message:warnings.join(" ")||null});if(finish.error)databaseFailure(finish.error,currentStage,"rpc:finish_financial_sync");
  if(counts.transactionFailures){const checkpoint=await supabase.from("bank_connections").update({last_successful_sync_at:connection.data.last_successful_sync_at??null,sync_cursor:{lastWindowStart:dateFrom??null,transactionIncomplete:true}}).eq("id",connectionId).eq("owner_id",userId);if(checkpoint.error)databaseFailure(checkpoint.error,currentStage,"bank_connections.checkpoint")}
  console.info("[Atlas Pluggy Sync]",{operation:"sync",stage:currentStage,status:finalStatus,mode:effectiveFull?"full":"incremental",durationMs:Date.now()-started,user:maskId(userId),item:maskId(itemId),counts,warnings: warnings.length});return {counts,warnings};
 }catch(error){
  const failure=wrap(error,currentStage,"A sincronização não pôde ser concluída.");const normalized=logIntegrationFailure(failure,{stage:currentStage,durationMs:Date.now()-started,user:userId,item:itemId});
  if(runId){const finish=await supabase.rpc("finish_financial_sync",{target_run:runId,final_status:"failed",counters:counts,failure_code:normalized.code??"sync_failed",failure_message:sanitizeDiagnostic(normalized.message,300)??"Falha de sincronização."});if(finish.error)console.error("[Atlas Supabase Failure]",{stage:"sync_run_finalize",table:"rpc:finish_financial_sync",code:sanitizeDiagnostic(finish.error.code),message:sanitizeDiagnostic(finish.error.message),details:sanitizeDiagnostic(finish.error.details),hint:sanitizeDiagnostic(finish.error.hint)})}
  throw failure;
 }
}
