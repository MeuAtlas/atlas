import type { JsonRecord, PluggyAccount, PluggyInvestment, PluggyLoan, PluggyTransaction } from "./types";

const text=(value:unknown,fallback="")=>typeof value==="string"&&value.trim()?value.trim():fallback;
const number=(value:unknown)=>typeof value==="number"&&Number.isFinite(value)?value:0;
const isoDate=(value:unknown)=>{const raw=text(value);const date=raw?new Date(raw):new Date();return Number.isNaN(date.valueOf())?new Date().toISOString().slice(0,10):date.toISOString().slice(0,10)};
const lower=(...values:unknown[])=>values.map(value=>text(value).toLowerCase()).join(" ");
export const safeMetadata=(value:JsonRecord)=>Object.fromEntries(["status","type","subtype","categoryId","providerId","code","dueDate"].flatMap(key=>value[key]===undefined?[]:[[key,value[key]]]));

export function mapAccount(account:PluggyAccount,ownerId:string,connectionId:string){
 const sourceType=lower(account.subtype,account.type);
 const accountType=sourceType.includes("saving")?"savings":sourceType.includes("investment")?"investment":sourceType.includes("digital")?"digital":sourceType.includes("checking")?"checking":"other";
 return {owner_id:ownerId,bank_connection_id:connectionId,name:text(account.marketingName,text(account.name,"Conta conectada")),institution_name:null,account_type:accountType,currency:text(account.currencyCode,"BRL").slice(0,3),current_balance:number(account.balance),balance_updated_at:new Date().toISOString(),source:"pluggy",external_id:account.id,last_sync_at:new Date().toISOString(),provider_status:"active",provider_metadata:safeMetadata(account)};
}

function creditData(account:PluggyAccount){return account.creditData&&typeof account.creditData==="object"?account.creditData:{}}
export function mapCard(account:PluggyAccount,ownerId:string,connectionId:string){
 const credit=creditData(account); const rawNumber=text(account.number); const lastFour=rawNumber.replace(/\D/g,"").slice(-4)||null;
 return {owner_id:ownerId,bank_connection_id:connectionId,name:text(account.marketingName,text(account.name,"Cartão conectado")),institution_name:null,last_four_digits:lastFour,brand:text(credit.brand)||null,credit_limit:Math.abs(number(credit.creditLimit??credit.limit)),used_limit:Math.abs(number(credit.balanceClose??credit.balance)),current_balance:number(account.balance),closing_day:Math.max(1,Math.min(31,number(credit.balanceCloseDate)||1)),due_day:Math.max(1,Math.min(31,number(credit.balanceDueDate)||1)),source:"pluggy",external_id:account.id,provider_status:"active",last_sync_at:new Date().toISOString(),provider_metadata:safeMetadata(account)};
}

export function classifyTransaction(transaction:PluggyTransaction,isCreditCard=false){
 const amount=number(transaction.amount); const clue=lower(transaction.type,transaction.category,transaction.description);
 const invoicePayment=/pagamento.*fatura|fatura.*pagamento|credit card payment/.test(clue);
 const refund=/estorno|reembolso|refund|chargeback/.test(clue);
 const transfer=/transfer|pix|ted|doc/.test(clue);
 if(invoicePayment)return {transaction_type:"transfer",cash_flow_kind:"invoice_payment",suspected_transfer:false,review_status:"reviewed"} as const;
 if(refund)return {transaction_type:"refund",cash_flow_kind:"refund",suspected_transfer:false,review_status:"pending"} as const;
 if(isCreditCard)return amount>=0?{transaction_type:"expense",cash_flow_kind:"consumption",suspected_transfer:false,review_status:"pending"} as const:{transaction_type:"reversal",cash_flow_kind:"credit",suspected_transfer:false,review_status:"pending"} as const;
 const income=clue.includes("credit")||(!clue.includes("debit")&&amount>0);
 return {transaction_type:income?"income":"expense",cash_flow_kind:transfer?"transfer_suspected":income?"income":"expense",suspected_transfer:transfer,review_status:transfer?"pending":"reviewed"} as const;
}

export function mapTransaction(transaction:PluggyTransaction,ownerId:string,connectionId:string,target:{accountId?:string;cardId?:string;isCreditCard:boolean}){
 const classification=classifyTransaction(transaction,target.isCreditCard);
 const date=isoDate(transaction.date);
 return {owner_id:ownerId,bank_connection_id:connectionId,account_id:target.accountId??null,credit_card_id:target.cardId??null,description:text(transaction.description,"Movimentação importada").slice(0,160),amount:Math.abs(number(transaction.amount)),competence_date:date,realized_at:transaction.status==="PENDING"?null:`${date}T12:00:00.000Z`,status:transaction.status==="PENDING"?"pending":"realized",source:"pluggy",external_id:transaction.id,provider_category:text(transaction.category)||null,original_currency:text(transaction.currencyCode,"BRL").slice(0,3),original_amount:number(transaction.amount),merchant:text(transaction.merchant?.name)||null,provider_metadata:safeMetadata(transaction),...classification};
}

export function mapInvestment(item:PluggyInvestment,ownerId:string,connectionId:string){return {owner_id:ownerId,bank_connection_id:connectionId,source:"pluggy",external_id:item.id,name:text(item.name,"Investimento"),investment_type:text(item.type,"OTHER"),institution_name:null,currency:text(item.currencyCode,"BRL").slice(0,3),balance:number(item.balance??item.amount??item.value),quantity:number(item.quantity),unit_value:number(item.unitValue),provider_code:text(item.code)||null,due_date:item.dueDate?isoDate(item.dueDate):null,provider_metadata:safeMetadata(item),last_sync_at:new Date().toISOString()}}
export function mapLoan(item:PluggyLoan,ownerId:string,connectionId:string){return {owner_id:ownerId,bank_connection_id:connectionId,source:"pluggy",external_id:item.id,name:text(item.productName,text(item.type,"Empréstimo")),loan_type:text(item.type,"OTHER"),contract_number:text(item.contractNumber)||null,currency:text(item.currencyCode,"BRL").slice(0,3),original_amount:Math.abs(number(item.amount)),balance_due:Math.abs(number(item.balanceDue)),interest_rate:number(item.interestRate),installments:number(item.installments)||null,start_date:item.startDate?isoDate(item.startDate):null,end_date:item.endDate?isoDate(item.endDate):item.dueDate?isoDate(item.dueDate):null,provider_metadata:safeMetadata(item),last_sync_at:new Date().toISOString()}}

export function cursorFromNext(next:unknown){if(typeof next!=="string"||!next)return undefined;try{const cursor=new URL(next,"https://api.pluggy.ai").searchParams.get("after");return cursor??(!next.includes("/")&&!next.includes("?")?next:undefined)}catch{return undefined}}

export function findSuspectedTransferIds(rows:{id:string;accountId:string;amount:number;direction:"in"|"out";date:string;description:string}[]){
 const ids=new Set<string>();
 for(let left=0;left<rows.length;left++)for(let right=left+1;right<rows.length;right++){
  const a=rows[left],b=rows[right];if(a.accountId===b.accountId||a.direction===b.direction||Math.abs(a.amount-b.amount)>0.009)continue;
  const distance=Math.abs(new Date(a.date).valueOf()-new Date(b.date).valueOf());if(!Number.isFinite(distance)||distance>3*24*60*60*1000)continue;
  const clue=lower(a.description,b.description);if(!/transfer|pix|ted|doc/.test(clue))continue;ids.add(a.id);ids.add(b.id);
 }
 return ids;
}
