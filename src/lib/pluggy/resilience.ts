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

const dropped=(previous:number,current:number,ratio=.7)=>
  previous>0&&current<previous*ratio;

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
  return partial&&(incoming===null||incoming===undefined||incoming===0)&&current!==null&&current!==undefined&&current!==0;
}
