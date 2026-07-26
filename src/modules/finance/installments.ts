import type { CardPurchase } from "./types";

export type InstallmentFilter="all"|"cash"|"installments"|"last"|"long";

export function isInstallmentPurchase(purchase:CardPurchase){
  return purchase.is_installment===true &&
    purchase.installment_number!==null &&
    purchase.installment_count!==null &&
    purchase.installment_count>1;
}

export function installmentLabel(purchase:CardPurchase,compact=false){
  if(isInstallmentPurchase(purchase)){
    const base=compact
      ? `${purchase.installment_number}/${purchase.installment_count}`
      : `Parcela ${purchase.installment_number} de ${purchase.installment_count}`;
    if(compact)return base;
    if(purchase.installment_confidence==="inferred")return `${base} · identificada pela descrição`;
    if(purchase.installment_confidence==="manual")return `${base} · informada manualmente`;
    return base;
  }
  return null;
}

export function matchesInstallmentFilter(purchase:CardPurchase,filter:InstallmentFilter){
  const installment=isInstallmentPurchase(purchase);
  if(filter==="cash")return !installment;
  if(filter==="installments")return installment;
  if(filter==="last")return installment&&purchase.installment_number===purchase.installment_count;
  if(filter==="long")return installment&&Number(purchase.installment_count)>=6;
  return true;
}

export function estimatedInstallmentRemaining(purchase:CardPurchase){
  if(!isInstallmentPurchase(purchase)||purchase.status==="cancelled")return null;
  return Number(purchase.installment_amount)*
    (Number(purchase.installment_count)-Number(purchase.installment_number));
}

function addMonths(value:string,offset:number){
  const [year,month]=value.slice(0,7).split("-").map(Number);
  return new Date(Date.UTC(year,month-1+offset,1)).toISOString().slice(0,7);
}

export function buildFutureInstallmentProjection(purchase:CardPurchase,related:CardPurchase[]){
  if(!purchase.installment_plan_id||!isInstallmentPurchase(purchase)||
    purchase.status==="cancelled"||purchase.installment_confidence==="unknown")return [];
  const monthly=Number(purchase.installment_amount);
  if(!Number.isFinite(monthly)||monthly<=0||
    related.some(item=>Math.abs(Number(item.installment_amount)-monthly)>.01))return [];
  const officialNumbers=new Set(related.map(item=>item.installment_number).filter((value):value is number=>value!==null));
  const reference=(purchase.bill_forecast_date||purchase.competence_date||purchase.purchase_date).slice(0,7);
  const rows:Array<{installmentNumber:number;referenceMonth:string;amount:number}>=[];
  for(let number=Number(purchase.installment_number)+1;number<=Number(purchase.installment_count);number++){
    if(!officialNumbers.has(number))rows.push({installmentNumber:number,referenceMonth:addMonths(reference,number-Number(purchase.installment_number)),amount:monthly});
  }
  return rows;
}
