import type {
  PluggyBill,
  PluggyBillFinanceCharge,
  PluggyBillPayment,
} from "./types";

export type InvoiceTotalSource=
  |"provider_bill"
  |"manual"
  |"confirmed"
  |"calculated"
  |"last_reliable"
  |"unavailable";

export type InvoiceTotalResolution={
  amount:number|null;
  source:InvoiceTotalSource;
  isReliable:boolean;
  isPartial:boolean;
};

export function optionalMoney(value:unknown){
  if(value===null||value===undefined)return null;
  const number=typeof value==="number"?value:Number(value);
  return Number.isFinite(number)?Math.abs(number):null;
}

export function shouldAcceptIncomingInvoiceTotal(input:{
  total:unknown;
  dataCompleteness:"complete"|"partial"|"unknown";
  source:"provider"|"calculated";
  officialBillPresent?:boolean;
  accountMatches?:boolean;
  cycleMatches?:boolean;
  paginationComplete?:boolean;
  itemHealthy?:boolean;
  connectorAvailable?:boolean;
  errorCount?:number;
  timedOut?:boolean;
}){
  const total=optionalMoney(input.total);
  if(total===null||input.dataCompleteness!=="complete")return false;
  if(input.paginationComplete===false||input.itemHealthy===false||
    input.connectorAvailable===false||input.timedOut===true||
    (input.errorCount??0)>0)return false;
  if(input.source==="provider")return input.officialBillPresent===true&&
    input.accountMatches===true&&input.cycleMatches===true;
  return true;
}

export function resolveInvoiceDisplayTotal(input:{
  providerInvoiceTotal?:unknown;
  providerReliable?:boolean;
  manualInvoiceTotal?:unknown;
  confirmedInvoiceTotal?:unknown;
  calculatedInvoiceTotal?:unknown;
  calculatedReliable?:boolean;
  lastReliableInvoiceTotal?:unknown;
  lastReliableReliable?:boolean;
  isPartial?:boolean;
}):InvoiceTotalResolution{
  const candidates:[InvoiceTotalSource,number|null,boolean][]=[
    ["confirmed",optionalMoney(input.confirmedInvoiceTotal),true],
    ["manual",optionalMoney(input.manualInvoiceTotal),true],
    ["provider_bill",optionalMoney(input.providerInvoiceTotal),input.providerReliable===true],
    ["calculated",optionalMoney(input.calculatedInvoiceTotal),input.calculatedReliable!==false],
    ["last_reliable",optionalMoney(input.lastReliableInvoiceTotal),input.lastReliableReliable!==false],
  ];
  const selected=candidates.find(([,amount,reliable])=>amount!==null&&reliable);
  return selected
    ? {amount:selected[1],source:selected[0],isReliable:true,isPartial:input.isPartial===true}
    : {amount:null,source:"unavailable",isReliable:false,isPartial:input.isPartial===true};
}

export type BillPaymentStatus=
  |"open"|"partially_paid"|"paid"|"installment_payment"|"overdue"|"unknown";
export type BillReconciliationStatus=
  |"reconciled"|"incomplete"|"over_identified"|"unavailable";

export function resolveBillPaymentStatus(input:{
  total:number|null;
  payments:Pick<PluggyBillPayment,"valueType"|"amount">[];
  dueDate?:string|null;
  referenceDate?:Date;
}):{status:BillPaymentStatus;paidAmount:number}{
  const valid=input.payments
    .map(payment=>({...payment,amount:optionalMoney(payment.amount)}))
    .filter((payment):payment is typeof payment&{amount:number}=>payment.amount!==null);
  const paidAmount=valid.reduce((sum,payment)=>sum+payment.amount,0);
  if(valid.some(payment=>payment.valueType==="INSTALLMENT_PAYMENT"))
    return {status:"installment_payment",paidAmount};
  if(input.total!==null&&valid.some(payment=>
    payment.valueType==="FULL_PAYMENT"&&Math.abs(payment.amount-input.total!)<=.01))
    return {status:"paid",paidAmount};
  if(input.total!==null&&paidAmount>0&&paidAmount>=input.total-.01)
    return {status:"paid",paidAmount};
  if(paidAmount>0)return {status:"partially_paid",paidAmount};
  if(!input.dueDate)return {status:"unknown",paidAmount};
  const today=(input.referenceDate??new Date()).toISOString().slice(0,10);
  return {status:input.dueDate.slice(0,10)<today?"overdue":"open",paidAmount};
}

export function resolveBillReconciliationStatus(
  confirmedTotal:unknown,
  calculatedTotal:unknown,
):{status:BillReconciliationStatus;difference:number|null}{
  const confirmed=optionalMoney(confirmedTotal);
  const calculated=optionalMoney(calculatedTotal);
  if(confirmed===null||calculated===null)
    return {status:"unavailable",difference:null};
  const difference=Math.round((confirmed-calculated)*100)/100;
  if(Math.abs(difference)<=.01)return {status:"reconciled",difference};
  return {
    status:difference>0?"incomplete":"over_identified",
    difference,
  };
}

const safeDate=(value:unknown)=>
  typeof value==="string"&&!Number.isNaN(Date.parse(value))
    ? value.slice(0,10)
    : null;

export function normalizeProviderBill(input:{
  bill:PluggyBill;
  previousClosingDate?:string|null;
}){
  const {bill}=input;
  const closingDate=safeDate(bill.billClosingDate);
  const dueDate=safeDate(bill.dueDate);
  const cycleStart=closingDate&&input.previousClosingDate
    ? new Date(Date.parse(`${input.previousClosingDate.slice(0,10)}T12:00:00Z`)+86_400_000)
        .toISOString().slice(0,10)
    : null;
  return {
    providerBillId:bill.id,
    providerAccountId:bill.accountId??null,
    closingDate,
    dueDate,
    cycleStart,
    cycleEnd:closingDate,
    currencyCode:String(bill.totalAmountCurrencyCode??"BRL").slice(0,3),
    providerInvoiceTotal:optionalMoney(bill.totalAmount),
    minimumPaymentAmount:optionalMoney(bill.minimumPaymentAmount),
    allowsInstallments:bill.allowsInstallments===true,
    payments:Array.isArray(bill.payments)?bill.payments:[] as PluggyBillPayment[],
    financeCharges:Array.isArray(bill.financeCharges)
      ? bill.financeCharges
      : [] as PluggyBillFinanceCharge[],
  };
}
