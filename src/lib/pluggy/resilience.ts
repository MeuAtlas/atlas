export type SyncSnapshot={
  creditAccounts:number;
  cards:number;
  transactions:number;
  bills:number;
  instruments:number;
};

export type CompletenessAssessment={
  completeness:"complete"|"partial";
  reasons:string[];
  partialDataCount:number;
};

export type DataCompleteness="complete"|"partial"|"unknown";

const dropped=(previous:number,current:number,ratio=.7)=>
  previous>0&&current<previous*ratio;

export function isUnavailableProviderValue(value:unknown){
  return value===null||value===undefined||
    (typeof value==="number"&&!Number.isFinite(value));
}

export function isConfirmedZero(value:unknown,completeness:DataCompleteness){
  return completeness==="complete"&&typeof value==="number"&&
    Number.isFinite(value)&&Object.is(Math.abs(value),0);
}

export function shouldPreservePreviousValue(input:{
  previous:unknown;
  incoming:unknown;
  completeness:DataCompleteness;
}){
  if(input.completeness!=="partial")return false;
  if(isUnavailableProviderValue(input.incoming))return !isUnavailableProviderValue(input.previous);
  return typeof input.incoming==="number"&&input.incoming===0&&
    typeof input.previous==="number"&&Number.isFinite(input.previous)&&
    input.previous!==0;
}

export function hasInterruptedPagination(input:{
  page?:number;
  totalPages?:number;
  total?:number;
  totalResults?:number;
  received:number;
  hasNext:boolean;
}){
  if(input.hasNext)return false;
  if(
    Number.isFinite(input.page)&&Number.isFinite(input.totalPages)&&
    Number(input.page)<Number(input.totalPages)
  )return true;
  const expected=Number.isFinite(input.totalResults)
    ? Number(input.totalResults)
    : Number.isFinite(input.total)
      ? Number(input.total)
      : null;
  return expected!==null&&input.received<expected;
}

export function shouldAcceptIncomingFinancialData(input:{
  itemStatus?:string|null;
  executionStatus?:string|null;
  connectorAvailable?:boolean;
  paginationComplete:boolean;
  errorCount:number;
  previousCount?:number|null;
  incomingCount?:number|null;
  previousValue?:number|null;
  incomingValue?:number|null;
  providerBillPresent?:boolean;
  dataCompleteness:DataCompleteness;
  lastCompleteSyncAt?:string|null;
}){
 const reasons:string[]=[];
 const item=String(input.itemStatus??"").toUpperCase();
 const execution=String(input.executionStatus??"").toUpperCase();
 if(!["UPDATED","SUCCESS"].includes(item))reasons.push("item_not_updated");
 if(execution&&execution!=="SUCCESS")reasons.push("execution_not_complete");
 if(input.connectorAvailable===false)reasons.push("connector_unavailable");
 if(!input.paginationComplete)reasons.push("pagination_incomplete");
 if(input.errorCount>0)reasons.push("provider_errors");
 if(input.dataCompleteness!=="complete")reasons.push("data_not_complete");
 if((input.previousCount??0)>0&&input.incomingCount===0)
  reasons.push("records_dropped_to_zero");
 if((input.previousValue??0)>0&&input.incomingValue===0)
  reasons.push("value_dropped_to_zero");
 if(input.providerBillPresent===false&&(input.previousValue??0)>0)
  reasons.push("provider_bill_missing");
 return {
  accept:reasons.length===0,
  preservePrevious:reasons.length>0,
  reasons:[...new Set(reasons)],
 };
}

export function assessSyncCompleteness(input:{
  previous:SyncSnapshot|null;
  current:SyncSnapshot;
  full:boolean;
  warningCount:number;
  transactionFailures:number;
  itemStatus?:string|null;
}):CompletenessAssessment{
  const reasons:string[]=[];
  const itemStatus=String(input.itemStatus??"").toUpperCase();
  if(["ERROR","OUTDATED","LOGIN_ERROR"].includes(itemStatus))reasons.push("provider_item_unavailable");
  if(input.warningCount>0)reasons.push("provider_warning");
  if(input.transactionFailures>0)reasons.push("transaction_endpoint_failure");
  if(input.previous){
    if(input.current.creditAccounts<input.previous.creditAccounts)reasons.push("credit_account_missing");
    if(input.current.cards<input.previous.cards)reasons.push("card_missing");
    if(input.current.bills<input.previous.bills)reasons.push("official_bill_missing");
    if(input.current.instruments<input.previous.instruments)reasons.push("instrument_missing");
    if(input.full&&dropped(input.previous.transactions,input.current.transactions))reasons.push("abrupt_transaction_drop");
    if(input.full&&input.previous.transactions>0&&input.current.transactions===0)reasons.push("previously_populated_card_empty");
  }
  const unique=[...new Set(reasons)];
  return {
    completeness:unique.length?"partial":"complete",
    reasons:unique,
    partialDataCount:Math.max(0,
      (input.previous?.transactions??input.current.transactions)-input.current.transactions),
  };
}

export function shouldPreserveProviderValue(current:unknown,incoming:unknown,partial:boolean){
  return shouldPreservePreviousValue({
    previous:current,
    incoming,
    completeness:partial?"partial":"complete",
  });
}
