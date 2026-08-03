import "server-only";

import {createHash} from "node:crypto";
import {normalizeProviderBill,resolveBillPaymentStatus} from "./bill-domain";
import {databaseFailure,maskId} from "./diagnostics";
import {findPluggyIdentityByItem,retrievePluggyBill} from "./client";
import {IntegrationSyncError,normalizeIntegrationError} from "./errors";
import type {PluggyBill,PluggyIdentity} from "./types";
import type {DataCompleteness} from "./resilience";

type DbClient=Awaited<ReturnType<typeof import("@/lib/supabase/server").createClient>>;

const iso=(value:string|null|undefined)=>value?.slice(0,10)??null;
const referenceMonth=(closing:string|null,due:string|null)=>
  `${(closing??due)!.slice(0,7)}-01`;

export async function persistOfficialBills(input:{
  supabase:DbClient;
  ownerId:string;
  connectionId:string;
  billsByProviderAccount:Map<string,PluggyBill[]>;
  cardMap:Map<string,string>;
  completeness?:DataCompleteness;
}){
 const {supabase,ownerId,connectionId,billsByProviderAccount,cardMap}=input;
 const completeness=input.completeness??"complete";
 let billCount=0,paymentCount=0,chargeCount=0;
 for(const [providerAccountId,providerBills] of billsByProviderAccount){
  const cardId=cardMap.get(providerAccountId);if(!cardId)continue;
  const card=await supabase.from("credit_cards")
    .select("workspace_id,visibility")
    .eq("id",cardId).eq("owner_id",ownerId).single();
  if(card.error)databaseFailure(card.error,"bills_fetch","credit_cards.bill_scope");
  const sorted=[...providerBills].sort((left,right)=>
    String(left.billClosingDate??left.dueDate).localeCompare(
      String(right.billClosingDate??right.dueDate),
    ));
  let previousClosing:string|null=null;
  for(const bill of sorted){
   const normalized=normalizeProviderBill({bill,previousClosingDate:previousClosing});
   if(!normalized.dueDate)continue;
   if(normalized.providerInvoiceTotal===null){
    throw new IntegrationSyncError("A Pluggy retornou uma fatura oficial sem total válido.",{
     code:"pluggy_bill_invalid_total",stage:"bills_fetch",
    });
   }
   const closing=normalized.closingDate??normalized.dueDate;
   const reference=referenceMonth(closing,normalized.dueDate);
   const existing=await supabase.from("card_invoices").select("id,provider_updated_at,last_complete_sync_at,last_reliable_snapshot_at")
    .eq("owner_id",ownerId).eq("provider","pluggy")
    .eq("provider_bill_id",normalized.providerBillId).maybeSingle();
   if(existing.error)databaseFailure(existing.error,"bills_fetch","card_invoices.provider_lookup");
   if(
    existing.data?.provider_updated_at&&bill.updatedAt&&
    Date.parse(String(existing.data.provider_updated_at))>Date.parse(bill.updatedAt)
   )continue;
   const paymentState=resolveBillPaymentStatus({
    total:normalized.providerInvoiceTotal,
    payments:normalized.payments,
    dueDate:normalized.dueDate,
   });
   const row={
    owner_id:ownerId,workspace_id:card.data.workspace_id,
    visibility:card.data.visibility,card_id:cardId,
    reference_month:reference,
    cycle_start_date:normalized.cycleStart,
    cycle_end_date:normalized.cycleEnd??closing,
    closing_date:closing,due_date:normalized.dueDate,
    total_amount:normalized.providerInvoiceTotal,
    invoice_total:normalized.providerInvoiceTotal,
     paid_amount:paymentState.paidAmount,
     outstanding_amount:Math.max(0,normalized.providerInvoiceTotal-paymentState.paidAmount),
     purchase_count:0,status:paymentState.status==="installment_payment"
      ? "partially_paid"
      : paymentState.status==="unknown"?"open":paymentState.status,
     source:"pluggy_bill",
    total_source:"provider_bill",external_id:`pluggy:bill:${bill.id}`,
    provider:"pluggy",provider_bill_id:bill.id,
    provider_account_id:providerAccountId,
    provider_invoice_total:normalized.providerInvoiceTotal,
    minimum_payment_amount:normalized.minimumPaymentAmount,
    currency_code:normalized.currencyCode,
    allows_installments:normalized.allowsInstallments,
    data_completeness:completeness,provider_status:"available",
    last_sync_at:new Date().toISOString(),
    last_complete_sync_at:completeness==="complete"
      ? new Date().toISOString()
      : existing.data?.last_complete_sync_at??null,
    stale_since:completeness==="partial"?new Date().toISOString():null,
    last_provider_error:null,
    raw_breakdown_metadata:{
      paymentCount:normalized.payments.length,
      financeChargeCount:normalized.financeCharges.length,
      closingDateSource:normalized.closingDate?"provider_bill":"due_date_fallback",
    },
     provider_updated_at:bill.updatedAt??null,
     last_bank_total_updated_at:bill.updatedAt??new Date().toISOString(),
     last_remote_updated_at:bill.updatedAt??null,
     last_sync_attempt_at:new Date().toISOString(),
     last_successful_sync_at:new Date().toISOString(),
     last_reliable_snapshot_at:completeness==="complete"
      ? new Date().toISOString()
      : existing.data?.last_reliable_snapshot_at??null,
     sync_status:completeness==="complete"?"updated":"partially_updated",
     value_change_reason:completeness==="complete"
      ? "bank_total_changed"
      : "partial_sync_preserved",
     value_change_source:"pluggy_bill",
     updated_at:new Date().toISOString(),
   };
   const saved=existing.data
    ? await supabase.from("card_invoices").update(row)
        .eq("id",existing.data.id).eq("owner_id",ownerId).select("id").single()
    : await supabase.from("card_invoices").upsert(row,{
        onConflict:"card_id,reference_month",
      }).select("id").single();
   if(saved.error)databaseFailure(saved.error,"bills_fetch","card_invoices.official_bill");
   const billId=String(saved.data.id);billCount++;
   const payments=normalized.payments.flatMap(payment=>
    payment.id&&typeof payment.amount==="number"&&Number.isFinite(payment.amount)
      ? [{
          owner_id:ownerId,workspace_id:card.data.workspace_id,
          visibility:card.data.visibility,bill_id:billId,
          provider_payment_id:payment.id,
          value_type:["FULL_PAYMENT","INSTALLMENT_PAYMENT"].includes(String(payment.valueType))
            ? payment.valueType
            : "OTHER_PAYMENT",
          payment_date:iso(payment.paymentDate),
          payment_mode:["DEBIT_ACCOUNT","BANK_SLIP","PAYROLL_DEDUCTION","PIX"]
            .includes(String(payment.paymentMode))
            ? payment.paymentMode
            : null,
          amount:Math.abs(payment.amount),
          currency_code:String(payment.currencyCode??normalized.currencyCode).slice(0,3),
          provider:"pluggy",updated_at:new Date().toISOString(),
        }]
      : []);
   if(payments.length){const result=await supabase.from("credit_card_bill_payments")
    .upsert(payments,{onConflict:"owner_id,provider,provider_payment_id"});
    if(result.error)databaseFailure(result.error,"bills_fetch","credit_card_bill_payments.upsert");
    paymentCount+=payments.length}
   const charges=normalized.financeCharges.flatMap(charge=>
    charge.id&&typeof charge.amount==="number"&&Number.isFinite(charge.amount)
      ? [{
          owner_id:ownerId,workspace_id:card.data.workspace_id,
          visibility:card.data.visibility,bill_id:billId,
          provider_charge_id:charge.id,
          charge_type:["LATE_PAYMENT_REMUNERATIVE_INTEREST","LATE_PAYMENT_FEE",
            "LATE_PAYMENT_INTEREST","IOF"].includes(String(charge.type))
            ? charge.type
            : "OTHER",
          amount:Math.abs(charge.amount),
          currency_code:String(charge.currencyCode??normalized.currencyCode).slice(0,3),
          additional_info:typeof charge.additionalInfo==="string"
            ? charge.additionalInfo.slice(0,300)
            : null,
          provider:"pluggy",updated_at:new Date().toISOString(),
        }]
      : []);
   if(charges.length){const result=await supabase.from("credit_card_bill_finance_charges")
    .upsert(charges,{onConflict:"owner_id,provider,provider_charge_id"});
    if(result.error)databaseFailure(result.error,"bills_fetch","credit_card_bill_finance_charges.upsert");
    chargeCount+=charges.length}
   const recalculated=await supabase.rpc("recalculate_official_card_bill",{target_bill:billId});
   if(recalculated.error)databaseFailure(recalculated.error,"bills_fetch","rpc:recalculate_official_card_bill");
   previousClosing=normalized.closingDate??previousClosing;
  }
 }
 const linked=await supabase.rpc("link_official_bill_payments");
 if(linked.error)databaseFailure(linked.error,"bills_fetch","rpc:link_official_bill_payments");
 console.info("[Atlas Pluggy Bills]",{
  operation:"bills.persist",connection:maskId(connectionId),
  billCount,paymentCount,chargeCount,linkedPayments:Number(linked.data??0),
  completeness:"complete",
 });
 return {bills:billCount,payments:paymentCount,charges:chargeCount,
  linkedPayments:Number(linked.data??0),preserved:false};
}

export async function refreshOfficialBill(input:{
 supabase:DbClient;ownerId:string;providerBillId:string;
}){
 const local=await input.supabase.from("card_invoices")
  .select("id,card_id,provider_account_id")
  .eq("owner_id",input.ownerId).eq("provider","pluggy")
  .eq("provider_bill_id",input.providerBillId).maybeSingle();
 if(local.error)databaseFailure(local.error,"bills_fetch","card_invoices.bill_refresh_lookup");
 if(!local.data)throw new IntegrationSyncError("Fatura oficial não encontrada.",{
  code:"CREDIT_CARD_BILL_NOT_FOUND",stage:"bills_fetch",
 });
 try{
  const bill=await retrievePluggyBill(input.providerBillId);
  const card=await input.supabase.from("credit_cards")
   .select("bank_connection_id").eq("id",local.data.card_id)
   .eq("owner_id",input.ownerId).single();
  if(card.error)databaseFailure(card.error,"bills_fetch","credit_cards.bill_refresh");
  const accountId=String(bill.accountId??local.data.provider_account_id??"");
  if(!accountId)throw new IntegrationSyncError("A fatura não possui conta de origem.",{
   code:"pluggy_bill_missing_account",stage:"bills_fetch",
  });
  return persistOfficialBills({
   supabase:input.supabase,ownerId:input.ownerId,
   connectionId:String(card.data.bank_connection_id),
    billsByProviderAccount:new Map([[accountId,[bill]]]),
   cardMap:new Map([[accountId,String(local.data.card_id)]]),
   completeness:"complete",
  });
 }catch(error){
  const normalized=normalizeIntegrationError(error);
  if(normalized.status===404||normalized.code==="CREDIT_CARD_BILL_NOT_FOUND"){
   const preserved=await input.supabase.from("card_invoices").update({
    provider_status:"temporarily_unavailable",
    last_provider_error:"CREDIT_CARD_BILL_NOT_FOUND",
    stale_since:new Date().toISOString(),
    updated_at:new Date().toISOString(),
   }).eq("id",local.data.id).eq("owner_id",input.ownerId);
   if(preserved.error)databaseFailure(preserved.error,"bills_fetch","card_invoices.bill_preserve");
   return {bills:0,payments:0,charges:0,linkedPayments:0,preserved:true};
  }
  throw error;
 }
}

const normalizeName=(identity:PluggyIdentity)=>
  String(identity.fullName??identity.name??"").trim().replace(/\s+/g," ").toLocaleUpperCase("pt-BR")||null;
const documentValue=(identity:PluggyIdentity)=>
  String(identity.document??identity.taxNumber??"").replace(/\D/g,"");

export async function syncMinimalIdentity(input:{
  supabase:DbClient;ownerId:string;connectionId:string;itemId:string;
}){
 try{
  const identity=await findPluggyIdentityByItem(input.itemId);
  const document=documentValue(identity);
  const documentHash=document
   ? createHash("sha256").update(document).digest("hex")
   : null;
  const previous=await input.supabase.from("pluggy_item_identities")
   .select("document_hash").eq("bank_connection_id",input.connectionId)
   .eq("owner_id",input.ownerId).maybeSingle();
  if(previous.error)databaseFailure(previous.error,"item","pluggy_item_identities.compare");
  if(previous.data?.document_hash&&documentHash&&previous.data.document_hash!==documentHash){
   throw new IntegrationSyncError("Esta conexão pertence a outra conta bancária.",{
    code:"ITEM_ORIGINAL_CONNECTED_WITH_DIFFERENT_ACCOUNT",stage:"item",
   });
  }
  const row={
   owner_id:input.ownerId,bank_connection_id:input.connectionId,
   provider_identity_id:identity.id,provider_item_id:input.itemId,
   normalized_name:normalizeName(identity),
   document_hash:documentHash,
   document_mask:document
    ? `${document.slice(0,3)}***${document.slice(-2)}`
    : null,
   document_type:String(identity.documentType??"").slice(0,30)||null,
   ownership_validated:false,last_verified_at:new Date().toISOString(),
   updated_at:new Date().toISOString(),
  };
  const result=await input.supabase.from("pluggy_item_identities").upsert(row,{
   onConflict:"bank_connection_id",
  });
  if(result.error)databaseFailure(result.error,"item","pluggy_item_identities.upsert");
  return true;
 }catch(error){
  const normalized=normalizeIntegrationError(error);
  if(normalized.status===404||normalized.code==="IDENTITY_NOT_FOUND")return false;
  throw error;
 }
}
