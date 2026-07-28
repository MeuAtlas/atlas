"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { throwSupabaseError } from "@/lib/errors";
import { buildLoanProjections } from "@/lib/pluggy/loan-projections";
import { localDateInTimeZone } from "@/lib/pluggy/provider-transaction-date";
import { requireFinanceAccess } from "./access";
import { amountField,dateField,enumField,optionalText,textField } from "./validation";
import {
  buildPostedInstallmentOccurrence,
  normalizeInstallmentMerchant,
  projectInstallmentSeed,
} from "./open-card-cycle";
import { invalidateOpenInvoiceCache } from "./open-invoice-cache";

function refreshFinance(){for(const path of ["/financeiro","/financeiro/movimentacoes","/financeiro/contas","/financeiro/cartoes","/financeiro/emprestimos"])revalidatePath(path)}
function optionalAmount(data:FormData,key:string){const raw=String(data.get(key)??"").trim().replace(/[R$\s]/g,"");if(!raw)return null;const normalized=raw.includes(",")?raw.replace(/\./g,"").replace(",","."):raw;const value=Number(normalized);if(!Number.isFinite(value)||value<0)throw new Error(`Valor invalido em ${key}.`);return value}
function optionalInteger(data:FormData,key:string){const value=optionalAmount(data,key);if(value===null)return null;if(!Number.isInteger(value))throw new Error(`Quantidade invalida em ${key}.`);return value}

export async function createLoan(data:FormData){const {supabase,user}=await requireFinanceAccess();const externalId=crypto.randomUUID();const payroll=data.get("payroll_deducted")==="on";const total=optionalInteger(data,"installment_count");const paid=optionalInteger(data,"installments_paid")??0;if(total!==null&&paid>total)throw new Error("Parcelas pagas nao podem superar o total.");const contracted=optionalAmount(data,"contracted_amount");const outstanding=optionalAmount(data,"outstanding_balance");const finalDue=optionalText(data,"final_due_date",10);const row={owner_id:user.id,workspace_id:null,bank_connection_id:null,source:"manual",external_id:externalId,name:textField(data,"name"),institution_name:optionalText(data,"institution_name"),loan_type:textField(data,"loan_type",80),subtype:null,contracted_amount:contracted,outstanding_balance:outstanding,installment_amount:optionalAmount(data,"installment_amount"),installment_count:total,installments_paid:paid,installments_remaining:total===null?null:total-paid,interest_rate:(optionalAmount(data,"interest_rate")??0)/100||null,effective_cost_rate:null,contract_date:null,first_installment_date:optionalText(data,"first_installment_date",10),next_installment_date:null,final_due_date:finalDue,payroll_deducted:payroll,payment_source:payroll?"payroll":"other",currency:"BRL",status:"active",visibility:"private",notes:optionalText(data,"notes",1000),raw_metadata:{manual:true},provider_metadata:{manual:true},original_amount:contracted,balance_due:outstanding,installments:total,start_date:null,end_date:finalDue};const inserted=await supabase.from("financial_loans").insert(row).select("id").single();if(inserted.error)throwSupabaseError(inserted.error,"criar emprestimo","Nao foi possivel cadastrar o emprestimo.");const projections=buildLoanProjections({loanId:String(inserted.data.id),ownerId:user.id,externalId,name:row.name,installmentAmount:row.installment_amount,installmentCount:total,installmentsPaid:paid,installmentsRemaining:row.installments_remaining,firstInstallmentDate:row.first_installment_date,finalDueDate:row.final_due_date,payrollDeducted:payroll,source:"manual"});if(projections.length){const result=await supabase.from("financial_transactions").upsert(projections,{onConflict:"owner_id,source,external_id"});if(result.error)throwSupabaseError(result.error,"projetar parcelas","Contrato salvo, mas nao foi possivel projetar parcelas.")}refreshFinance()}
export async function createAccount(data:FormData){const {supabase,user}=await requireFinanceAccess();const opening=Number(String(data.get("opening_balance")??"0").replace(",","."))||0;const result=await supabase.from("financial_accounts").insert({owner_id:user.id,name:textField(data,"name"),institution_name:optionalText(data,"institution_name"),account_type:enumField(data,"account_type",["checking","savings","digital","cash","investment","international","other"] as const),opening_balance:opening,current_balance:opening,visibility:"private",source:"manual"});if(result.error)throwSupabaseError(result.error,"criar conta","Nao foi possivel criar a conta.");refreshFinance()}
export async function archiveAccount(data:FormData){const {supabase,user}=await requireFinanceAccess();const result=await supabase.from("financial_accounts").update({status:"archived"}).eq("id",textField(data,"id",40)).eq("owner_id",user.id);if(result.error)throwSupabaseError(result.error,"arquivar conta","Nao foi possivel arquivar a conta.");refreshFinance()}
export async function createTransaction(data:FormData){const {supabase,user}=await requireFinanceAccess();const type=enumField(data,"transaction_type",["income","expense","transfer"] as const);const accountId=textField(data,"account_id",40);const destination=type==="transfer"?textField(data,"destination_account_id",40):null;if(type==="transfer"&&destination===accountId)throw new Error("Selecione contas diferentes.");const status=enumField(data,"status",["forecast","pending","realized"] as const);const result=await supabase.from("financial_transactions").insert({owner_id:user.id,account_id:accountId,destination_account_id:destination,category_id:optionalText(data,"category_id",40),transaction_type:type,transaction_role:type==="transfer"?"transfer":"cash_flow",financial_origin:type==="transfer"?"transfer":"bank_account",source_type:"manual",status,description:textField(data,"description"),amount:amountField(data),competence_date:dateField(data,"competence_date"),due_date:optionalText(data,"due_date",10),realized_at:status==="realized"?new Date().toISOString():null,visibility:"private",source:"manual",transfer_group_id:type==="transfer"?crypto.randomUUID():null});if(result.error)throwSupabaseError(result.error,"criar movimentacao","Nao foi possivel salvar a movimentacao.");refreshFinance()}
export async function updateTransactionStatus(data:FormData){const {supabase,user}=await requireFinanceAccess();const status=enumField(data,"status",["realized","cancelled"] as const);const result=await supabase.from("financial_transactions").update({status,realized_at:status==="realized"?new Date().toISOString():null}).eq("id",textField(data,"id",40)).eq("owner_id",user.id);if(result.error)throwSupabaseError(result.error,"atualizar movimentacao","Nao foi possivel atualizar a movimentacao.");refreshFinance()}
export async function updateBankTransactionClassification(data:FormData){
 const {supabase,user}=await requireFinanceAccess();
 const id=textField(data,"id",40);
 const direction=enumField(data,"bank_direction",["inflow","outflow","neutral","review"] as const);
 const role=enumField(data,"financial_role",["revenue","expense","cash_flow_only","transfer","debt_proceeds","debt_payment","investment_principal","correction","pending_review"] as const);
 const nature=enumField(data,"financial_nature",["salary","pix_received","pix_sent","investment_income","investment_application","investment_redemption","loan_proceeds","financing_payment","debt_payment","invoice_payment","transfer_internal","transfer_external","refund","reversal","fee","interest","purchase","bill_payment","other"] as const);
 const categoryId=optionalText(data,"category_id",40);
 const effectiveDate=optionalText(data,"user_effective_date",10);
 const reason=optionalText(data,"date_override_reason",240);
 if(effectiveDate&&!/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate))throw new Error("Data efetiva invalida.");
 if(effectiveDate&&!reason)throw new Error("Informe o motivo da correção da data.");
 const existing=await supabase.from("financial_transactions").select("id,source_type").eq("id",id).eq("owner_id",user.id).maybeSingle();
 if(existing.error||!existing.data||existing.data.source_type!=="bank")throw new Error("Movimentação bancária não encontrada ou sem permissão.");
 const legacy=role==="transfer"
  ?{transaction_type:"transfer",transaction_role:"transfer",financial_origin:"transfer",cash_flow_kind:"transfer_internal"}
  :role==="investment_principal"
   ?{transaction_type:direction==="inflow"?"income":"expense",transaction_role:"adjustment",financial_origin:"adjustment",cash_flow_kind:nature==="investment_redemption"?"investment_redemption":"investment_contribution"}
   :role==="correction"
    ?{transaction_type:"refund",transaction_role:"refund",financial_origin:"adjustment",cash_flow_kind:"refund"}
    :nature==="invoice_payment"
     ?{transaction_type:"transfer",transaction_role:"invoice_payment",financial_origin:"invoice",cash_flow_kind:"invoice_payment"}
     :{transaction_type:direction==="inflow"?"income":"expense",transaction_role:"cash_flow",financial_origin:"bank_account",cash_flow_kind:role==="debt_proceeds"?"loan_proceeds":role==="debt_payment"?nature:role==="revenue"?"income":role==="expense"?"expense":"cash_flow_only"};
 const now=new Date().toISOString();
 const result=await supabase.from("financial_transactions").update({...legacy,category_id:categoryId,bank_direction:direction,financial_nature:nature,financial_role:role,classification_source:"manual",classification_confidence:"high",classification_rule:"bank.manual_override",classification_version:"bank_classifier_v2",manually_confirmed:true,manual_override_at:now,manual_override_by:user.id,review_status:"reviewed",suspected_transfer:false,...(effectiveDate?{user_effective_at:`${effectiveDate}T12:00:00-03:00`,competence_date:effectiveDate,date_source:"user_confirmed",date_confidence:"high",date_override_reason:reason}: {})}).eq("id",id).eq("owner_id",user.id);
 if(result.error)throwSupabaseError(result.error,"corrigir classificação bancária","Não foi possível salvar a correção.");
 refreshFinance();
}
export async function restoreProviderTransactionDate(data:FormData){
 const {supabase,user}=await requireFinanceAccess();const id=textField(data,"id",40);
 const existing=await supabase.from("financial_transactions").select("id,provider_posted_at,bank_posted_at,effective_at").eq("id",id).eq("owner_id",user.id).eq("source_type","bank").maybeSingle();
 if(existing.error||!existing.data)throw new Error("Movimentação bancária não encontrada ou sem permissão.");
 const timestamp=existing.data.effective_at??existing.data.bank_posted_at??existing.data.provider_posted_at;
 if(!timestamp)throw new Error("A data original do provedor não está disponível neste registro legado.");
 const result=await supabase.from("financial_transactions").update({user_effective_at:null,competence_date:localDateInTimeZone(String(timestamp)),date_source:existing.data.effective_at?"provider_effective":"provider_posted",date_confidence:existing.data.effective_at?"high":"medium",date_override_reason:null,manual_override_at:new Date().toISOString(),manual_override_by:user.id}).eq("id",id).eq("owner_id",user.id);
 if(result.error)throwSupabaseError(result.error,"restaurar data bancária","Não foi possível restaurar a data informada pelo provedor.");
 refreshFinance();
}
export async function deleteTransaction(data:FormData){const {supabase,user}=await requireFinanceAccess();const result=await supabase.from("financial_transactions").delete().eq("id",textField(data,"id",40)).eq("owner_id",user.id);if(result.error)throwSupabaseError(result.error,"excluir movimentacao","Nao foi possivel excluir a movimentacao.");refreshFinance()}
export async function createCard(data:FormData){const {supabase,user}=await requireFinanceAccess();const result=await supabase.from("credit_cards").insert({owner_id:user.id,name:textField(data,"name"),institution_name:optionalText(data,"institution_name"),last_four_digits:optionalText(data,"last_four_digits",4),brand:optionalText(data,"brand",30),credit_limit:amountField(data,"credit_limit"),closing_day:Number(textField(data,"closing_day",2)),due_day:Number(textField(data,"due_day",2)),dates_source:"manual",linked_account_id:optionalText(data,"linked_account_id",40),visibility:"private",source:"manual"});if(result.error)throwSupabaseError(result.error,"criar cartao","Nao foi possivel criar o cartao.");refreshFinance()}
type CardListView="manage"|"archived";
async function changeCardStatus(data:FormData,status:"active"|"archived"){
 const {supabase,user}=await requireFinanceAccess();const id=textField(data,"id",40);const requestedView=String(data.get("view")??"manage");const view:CardListView=["manage","archived"].includes(requestedView)?requestedView as CardListView:"manage";
 const result=await supabase.from("credit_cards").update({status,user_archived_at:status==="archived"?new Date().toISOString():null}).eq("id",id).eq("owner_id",user.id).select("id").maybeSingle();
 if(result.error)throwSupabaseError(result.error,status==="active"?"desarquivar cartao":"arquivar cartao",status==="active"?"Nao foi possivel desarquivar o cartao.":"Nao foi possivel arquivar o cartao.");
 if(!result.data)throw new Error("Cartao nao encontrado ou sem permissao.");
 refreshFinance();redirect(`/financeiro/cartoes?view=${view}&toast=${status==="active"?"restored":"archived"}`);
}
export async function archiveCard(data:FormData){return changeCardStatus(data,"archived")}
export async function restoreCard(data:FormData){return changeCardStatus(data,"active")}
async function changeCardInstrumentArchive(data:FormData,restore:boolean){const {supabase,user}=await requireFinanceAccess();const id=textField(data,"id",40);const requestedView=String(data.get("view")??"manage");const view:CardListView=["manage","archived"].includes(requestedView)?requestedView as CardListView:"manage";const result=await supabase.from("credit_card_instruments").update({user_archived_at:restore?null:new Date().toISOString()}).eq("id",id).eq("owner_id",user.id).select("id").maybeSingle();if(result.error)throwSupabaseError(result.error,restore?"desarquivar instrumento":"arquivar instrumento",restore?"Nao foi possivel desarquivar o cartao.":"Nao foi possivel arquivar o cartao.");if(!result.data)throw new Error("Instrumento nao encontrado ou sem permissao.");refreshFinance();redirect(`/financeiro/cartoes?view=${view}&toast=${restore?"restored":"archived"}`)}
export async function archiveCardInstrument(data:FormData){return changeCardInstrumentArchive(data,false)}
export async function restoreCardInstrument(data:FormData){return changeCardInstrumentArchive(data,true)}
export async function updateCardInstrument(data:FormData){const {supabase,user}=await requireFinanceAccess();const id=textField(data,"id",40);const kind=enumField(data,"card_kind",["physical","virtual","online","additional","unknown"] as const);const result=await supabase.from("credit_card_instruments").update({display_name:optionalText(data,"display_name",80)??"Cartao",card_kind:kind,updated_at:new Date().toISOString()}).eq("id",id).eq("owner_id",user.id);if(result.error)throwSupabaseError(result.error,"personalizar instrumento","Nao foi possivel atualizar o cartao.");refreshFinance()}
export async function assignPurchaseInstrument(data:FormData){const {supabase,user}=await requireFinanceAccess();const purchaseId=textField(data,"purchase_id",40);const instrumentId=textField(data,"instrument_id",40);const [purchase,instrument]=await Promise.all([supabase.from("card_purchases").select("id,card_id").eq("id",purchaseId).eq("owner_id",user.id).single(),supabase.from("credit_card_instruments").select("id,credit_card_id,last_four_digits").eq("id",instrumentId).eq("owner_id",user.id).single()]);if(purchase.error||instrument.error||purchase.data.card_id!==instrument.data.credit_card_id)throw new Error("Instrumento invalido para esta compra.");const result=await supabase.from("card_purchases").update({instrument_id:instrumentId,instrument_last_four:instrument.data.last_four_digits,assignment_status:"assigned",assignment_source:"manual",assignment_confirmed_by_user:true,assigned_at:new Date().toISOString(),instrument_review_status:"identified"}).eq("id",purchaseId).eq("owner_id",user.id);if(result.error)throwSupabaseError(result.error,"associar compra","Nao foi possivel associar a compra.");refreshFinance()}
export async function updatePurchaseInstallment(data:FormData){const {supabase,user}=await requireFinanceAccess();const purchaseId=textField(data,"purchase_id",40);const cardId=textField(data,"card_id",40);const kind=enumField(data,"purchase_kind",["cash","installment"] as const);const installmentAmount=optionalAmount(data,"installment_amount");if(installmentAmount===null||installmentAmount<=0)throw new Error("Informe um valor de parcela valido.");let installmentNumber:number|null=null,installmentCount:number|null=null,totalPurchaseAmount:number|null=installmentAmount;if(kind==="installment"){installmentNumber=optionalInteger(data,"installment_number");installmentCount=optionalInteger(data,"installment_count");totalPurchaseAmount=optionalAmount(data,"total_purchase_amount");if(installmentNumber===null||installmentCount===null||installmentCount<2||installmentNumber<1||installmentNumber>installmentCount)throw new Error("Informe a parcela atual e o total de parcelas corretamente.");if(totalPurchaseAmount!==null&&totalPurchaseAmount<=0)throw new Error("Informe um valor total valido.")}const result=await supabase.from("card_purchases").update({is_installment:kind==="installment",installment_number:installmentNumber,installment_count:installmentCount,installment_amount:installmentAmount,total_purchase_amount:totalPurchaseAmount,total_amount:totalPurchaseAmount??installmentAmount,installment_source:"manual",installment_confidence:"manual",installment_manually_confirmed:true,review_status:"reviewed"}).eq("id",purchaseId).eq("card_id",cardId).eq("owner_id",user.id).select("id").maybeSingle();if(result.error)throwSupabaseError(result.error,"corrigir parcelamento","Nao foi possivel atualizar o parcelamento.");if(!result.data)throw new Error("Compra nao encontrada ou sem permissao.");refreshFinance();redirect(`/financeiro/cartoes/${cardId}?toast=installment-updated`)}
export async function addManualCardCycleMovement(data:FormData){
 const {supabase,user}=await requireFinanceAccess();
 const cycleId=textField(data,"cycle_id",40);
 const cardId=textField(data,"card_id",40);
 const instrumentId=optionalText(data,"instrument_id",40);
 const movementType=enumField(data,"movement_type",["new_purchase","posted_installment","credit","refund","fee","tax","adjustment"] as const);
 const description=textField(data,"description",160);
 const originalDate=dateField(data,"original_date");
 const postingDate=dateField(data,"posting_date");
 const competenceMonth=dateField(data,"competence_month").slice(0,7)+"-01";
 const amount=amountField(data);
 const currency=textField(data,"currency",3).toUpperCase();
 if(!/^[A-Z]{3}$/.test(currency))throw new Error("Informe uma moeda ISO com três letras.");
 const informedOriginalAmount=optionalAmount(data,"original_amount");
 const originalAmount=currency==="BRL"?null:informedOriginalAmount;
 const exchangeRate=optionalAmount(data,"exchange_rate");
 const foreignIofAmount=optionalAmount(data,"foreign_iof_amount");
 if(currency!=="BRL"&&(!originalAmount||originalAmount<=0))throw new Error("Informe o valor original da compra internacional.");
 if(currency==="BRL"&&(exchangeRate!==null||foreignIofAmount!==null))throw new Error("Cotação e IOF estrangeiro exigem uma moeda original diferente de BRL.");
 const note=optionalText(data,"note",500);
 const installmentNumber=movementType==="posted_installment"?optionalInteger(data,"installment_number"):null;
 const installmentTotal=movementType==="posted_installment"?optionalInteger(data,"installment_total"):null;
 if(movementType==="posted_installment"&&(installmentNumber===null||installmentTotal===null||installmentTotal<2||installmentNumber<1||installmentNumber>installmentTotal))throw new Error("Informe a parcela atual e o total corretamente.");
 const cycle=await supabase.from("card_invoices").select("id,card_id,due_date,status").eq("id",cycleId).eq("owner_id",user.id).maybeSingle();
 if(cycle.error||!cycle.data||cycle.data.status!=="open"||cycle.data.card_id!==cardId)throw new Error("Ciclo aberto não encontrado ou sem permissão.");
 let instrumentLastFour:string|null=null;
 let purchaseCardId=cardId;
 if(instrumentId){
  const instrument=await supabase.from("credit_card_instruments").select("id,credit_card_id,last_four_digits").eq("id",instrumentId).eq("owner_id",user.id).maybeSingle();
  if(instrument.error||!instrument.data)throw new Error("Cartão selecionado não pertence a este ciclo.");
  const instrumentData=instrument.data;
  const relatedCards=await supabase.from("credit_cards").select("id,bank_connection_id,status,user_archived_at").eq("owner_id",user.id).in("id",[cardId,instrumentData.credit_card_id]);
  if(relatedCards.error)throwSupabaseError(relatedCards.error,"validar cartão do ciclo","Não foi possível validar o cartão selecionado.");
  const primary=relatedCards.data?.find(card=>card.id===cardId);
  const selected=relatedCards.data?.find(card=>card.id===instrumentData.credit_card_id);
  const sameCycle=Boolean(primary&&selected&&selected.status==="active"&&!selected.user_archived_at&&(
   selected.id===primary.id||
   (primary.bank_connection_id&&selected.bank_connection_id===primary.bank_connection_id)
  ));
  if(!sameCycle)throw new Error("Cartão selecionado não pertence a este ciclo.");
  instrumentLastFour=instrumentData.last_four_digits;
  purchaseCardId=instrumentData.credit_card_id;
 }
 const externalId=`atlas:manual:${crypto.randomUUID()}`;
 const isCredit=["credit","refund"].includes(movementType);
 const inserted=await supabase.from("card_purchases").insert({
  owner_id:user.id,workspace_id:null,card_id:purchaseCardId,instrument_id:instrumentId,invoice_id:cycleId,
  description,total_amount:movementType==="posted_installment"&&installmentTotal?amount*installmentTotal:amount,installment_amount:amount,amount_brl:amount,provider_signed_amount:isCredit?-amount:amount,purchase_date:originalDate,posting_date:postingDate,
  competence_date:competenceMonth,installment_number:installmentNumber??1,installment_count:installmentTotal??1,
  is_installment:movementType==="posted_installment",installment_source:movementType==="posted_installment"?"manual":"unknown",
  installment_confidence:movementType==="posted_installment"?"manual":"unknown",installment_manually_confirmed:movementType==="posted_installment",
  visibility:"private",source:"manual",external_id:externalId,source_type:"card",financial_origin:"credit_card",
  transaction_role:isCredit?"refund":movementType==="adjustment"?"adjustment":"consumption",
  status:"realized",review_status:"reviewed",merchant:normalizeInstallmentMerchant(description),
  currency,original_amount:originalAmount,original_currency_code:currency==="BRL"?null:currency,
  exchange_rate:currency==="BRL"?null:exchangeRate,foreign_iof_amount:currency==="BRL"?null:foreignIofAmount,
  conversion_source:currency==="BRL"?null:"manual",converted_at:currency==="BRL"?null:new Date().toISOString(),
  provider_metadata:{manual:true,movementType,note,competenceMonth,currency},
  instrument_review_status:instrumentId?"identified":"pending",
 }).select("id").single();
 if(inserted.error)throwSupabaseError(inserted.error,"adicionar lançamento manual","Não foi possível salvar o lançamento.");
 if(currency!=="BRL"&&foreignIofAmount&&foreignIofAmount>0){
  const iof=await supabase.from("card_purchases").insert({
   owner_id:user.id,workspace_id:null,card_id:purchaseCardId,instrument_id:instrumentId,invoice_id:cycleId,
   description:"IOF DESPESA NO EXTERIOR",total_amount:foreignIofAmount,installment_amount:foreignIofAmount,
   amount_brl:foreignIofAmount,provider_signed_amount:foreignIofAmount,purchase_date:originalDate,
   posting_date:postingDate,competence_date:competenceMonth,installment_number:1,installment_count:1,
   is_installment:false,installment_source:"unknown",installment_confidence:"unknown",
   installment_manually_confirmed:false,visibility:"private",source:"manual",
   external_id:`${externalId}:iof`,source_type:"card",financial_origin:"credit_card",
   transaction_role:"consumption",status:"realized",review_status:"reviewed",
   merchant:"IOF DESPESA NO EXTERIOR",currency:"BRL",original_amount:null,
   original_currency_code:null,conversion_source:"manual",
   provider_metadata:{manual:true,movementType:"tax",relatedForeignPurchaseId:inserted.data.id,note},
   instrument_review_status:instrumentId?"identified":"pending",
  });
  if(iof.error)throwSupabaseError(iof.error,"adicionar IOF manual","A compra foi salva, mas o IOF não pôde ser registrado.");
 }
 if(movementType==="posted_installment"&&installmentNumber!==null&&installmentTotal!==null){
  const document=await supabase.from("invoice_documents").select("workspace_id").eq("user_id",user.id).in("card_id",[cardId,purchaseCardId]).is("deleted_at",null).order("created_at",{ascending:false}).limit(1).maybeSingle();
  if(document.error||!document.data)throw new Error("Lançamento salvo, mas não há espaço financeiro para projetar as parcelas.");
  const workspaceId=document.data.workspace_id;
  const dueDay=Number(String(cycle.data.due_date).slice(8,10))||10;
  const seed=buildPostedInstallmentOccurrence({
   sourceId:String(inserted.data.id),merchantNormalized:description,description,amount,currencyCode:"BRL",
   cardId:purchaseCardId,cardLastFour:instrumentLastFour,originalDate,currentInstallment:installmentNumber,
   totalInstallments:installmentTotal,confidence:1,
  },competenceMonth,dueDay);
  if(seed){
   const plan=await supabase.from("card_installment_plans").upsert({
    workspace_id:workspaceId,owner_id:user.id,card_id:purchaseCardId,card_last_four:instrumentLastFour,
    merchant_normalized:seed.merchantNormalized,description_reference:description,installment_amount:amount,currency_code:"BRL",
    total_installments:installmentTotal,first_known_installment:installmentNumber,latest_known_installment:installmentNumber,
    posted_installments:installmentNumber,remaining_installments:installmentTotal-installmentNumber,
    estimated_first_competence:new Date(Date.UTC(Number(competenceMonth.slice(0,4)),Number(competenceMonth.slice(5,7))-installmentNumber,1)).toISOString().slice(0,10),
    estimated_last_competence:new Date(Date.UTC(Number(competenceMonth.slice(0,4)),Number(competenceMonth.slice(5,7))-1+(installmentTotal-installmentNumber),1)).toISOString().slice(0,10),
    status:installmentNumber===installmentTotal?"completed":"active",confidence:1,
    matching_fingerprint:`atlas:manual-plan:${inserted.data.id}`,manually_reviewed:true,
   },{onConflict:"workspace_id,card_id,matching_fingerprint"}).select("id").single();
   if(plan.error)throwSupabaseError(plan.error,"criar plano manual","Lançamento salvo, mas não foi possível criar o plano.");
   const occurrences=projectInstallmentSeed(seed,dueDay).map(occurrence=>({
    workspace_id:workspaceId,owner_id:user.id,installment_plan_id:plan.data.id,card_id:purchaseCardId,
    bill_id:occurrence.competenceMonth===competenceMonth?cycleId:null,invoice_entry_id:null,
    competence_month:occurrence.competenceMonth,installment_number:occurrence.installmentNumber,
    total_installments:occurrence.totalInstallments,amount,status:occurrence.status,due_date:occurrence.dueDate,
    source:occurrence.status==="posted"?"manual":"projection",confidence:1,
   }));
   const saved=await supabase.from("card_installment_occurrences").upsert(occurrences,{onConflict:"installment_plan_id,installment_number"});
   if(saved.error)throwSupabaseError(saved.error,"projetar parcelas manuais","Lançamento salvo, mas as parcelas futuras não puderam ser criadas.");
  }
 }
 invalidateOpenInvoiceCache([{cycleId,workspaceId:null}]);
 refreshFinance();
 revalidatePath("/financeiro/planejamento");
 redirect(`/financeiro/movimentacoes?type=card&cycle=${cycleId}&toast=movement-added`);
}

export async function correctForeignCardMovementAmounts(data: FormData) {
 const {supabase,user}=await requireFinanceAccess();
 const rawMovementId=textField(data,"movement_id",80);
 const movementId=rawMovementId.replace(/^card-purchase:/,"");
 const cycleId=textField(data,"cycle_id",40);
 const originalCurrencyCode=textField(data,"original_currency_code",3).toUpperCase();
 if(!/^[A-Z]{3}$/.test(originalCurrencyCode)||originalCurrencyCode==="BRL"){
  throw new Error("Informe a moeda estrangeira original.");
 }
 const originalAmount=amountField(data,"original_amount");
 const amountBrl=amountField(data,"amount_brl");
 const foreignIofAmount=optionalAmount(data,"foreign_iof_amount");
 const exchangeRate=optionalAmount(data,"exchange_rate");
 const correctionSource=enumField(data,"correction_source",["santander_manual","manual"] as const);
 const note=optionalText(data,"note",500);
 if(originalAmount<=0||amountBrl<=0)throw new Error("Os valores original e convertido devem ser maiores que zero.");
 if(exchangeRate!==null&&exchangeRate<=0)throw new Error("A cotaÃ§Ã£o deve ser maior que zero.");

 const purchase=await supabase.from("card_purchases")
  .select("id,card_id,invoice_id,purchase_date,installment_count,provider_metadata")
  .eq("id",movementId).eq("owner_id",user.id).maybeSingle();
 if(purchase.error||!purchase.data)throw new Error("Compra internacional nÃ£o encontrada ou sem permissÃ£o.");
 if(purchase.data.invoice_id&&purchase.data.invoice_id!==cycleId){
  throw new Error("A compra nÃ£o pertence ao ciclo informado.");
 }
 const cycle=await supabase.from("card_invoices")
  .select("id,workspace_id").eq("id",cycleId).eq("owner_id",user.id)
  .maybeSingle();
 if(cycle.error||!cycle.data)throw new Error("Ciclo da compra nÃ£o encontrado.");
 const providerMetadata=
  purchase.data.provider_metadata&&
  typeof purchase.data.provider_metadata==="object"&&
  !Array.isArray(purchase.data.provider_metadata)
   ? purchase.data.provider_metadata as Record<string,unknown>
   : {};
 const updated=await supabase.from("card_purchases").update({
  amount_brl:amountBrl,
  installment_amount:amountBrl,
  ...(Number(purchase.data.installment_count??1)<=1?{total_amount:amountBrl}:{}),
  original_amount:originalAmount,
  original_currency_code:originalCurrencyCode,
  currency:originalCurrencyCode,
  exchange_rate:exchangeRate,
  foreign_iof_amount:foreignIofAmount,
  conversion_source:"manual",
  conversion_confidence:1,
  converted_at:new Date().toISOString(),
  provider_metadata:{
   ...providerMetadata,
   foreignManualCorrection:{
    source:correctionSource,
    note,
    confirmedAt:new Date().toISOString(),
   },
  },
 }).eq("id",movementId).eq("owner_id",user.id);
 if(updated.error)throwSupabaseError(updated.error,"corrigir compra internacional","NÃ£o foi possÃ­vel salvar os valores convertidos.");

 if(foreignIofAmount!==null&&foreignIofAmount>0){
  const iof=await supabase.from("card_purchases")
   .select("id").eq("owner_id",user.id).eq("card_id",purchase.data.card_id)
   .eq("purchase_date",purchase.data.purchase_date)
   .eq("amount_brl",foreignIofAmount)
   .ilike("description","%IOF%EXTERIOR%")
   .neq("id",movementId).limit(1).maybeSingle();
  if(!iof.error&&iof.data){
   const linked=await supabase.from("card_purchases").update({
    related_foreign_purchase_id:movementId,
    transaction_role:"foreign_transaction_tax",
    entry_type:"tax",
    original_amount:null,
    original_currency_code:null,
    conversion_source:"manual",
   }).eq("id",iof.data.id).eq("owner_id",user.id);
   if(linked.error)throwSupabaseError(linked.error,"vincular IOF","A conversÃ£o foi salva, mas o IOF nÃ£o pÃ´de ser vinculado.");
  }
 }
 invalidateOpenInvoiceCache([{
  cycleId,
  workspaceId:cycle.data.workspace_id,
 }]);
 refreshFinance();
}

export async function updateCardDates(data:FormData){const {supabase,user}=await requireFinanceAccess();const closing=Number(textField(data,"closing_day",2));const due=Number(textField(data,"due_day",2));if(!Number.isInteger(closing)||closing<1||closing>31||!Number.isInteger(due)||due<1||due>31)throw new Error("Informe dias entre 1 e 31.");const result=await supabase.from("credit_cards").update({closing_day:closing,due_day:due,dates_source:"manual"}).eq("id",textField(data,"id",40)).eq("owner_id",user.id);if(result.error)throwSupabaseError(result.error,"configurar cartao","Nao foi possivel configurar o cartao.");refreshFinance()}
export async function confirmCurrentInvoiceAmount(data:FormData){
 const {supabase,user}=await requireFinanceAccess();
 const cardId=textField(data,"card_id",40);
 const referenceMonth=textField(data,"reference_month",10);
 if(!/^\d{4}-\d{2}-01$/.test(referenceMonth))throw new Error("Mes de referencia invalido.");
 const raw=String(data.get("official_amount")??"").trim().replace(/[R$\s]/g,"");
 const normalized=raw.includes(",")?raw.replace(/\./g,"").replace(",","."):raw;
 const officialAmount=Number(normalized);
 if(!Number.isFinite(officialAmount)||officialAmount<0)throw new Error("Informe um valor de fatura valido.");
 const card=await supabase.from("credit_cards").select("id").eq("id",cardId).eq("owner_id",user.id).single();
 if(card.error||!card.data)throw new Error("Cartao nao encontrado ou sem permissao.");
 const informedAt=new Date().toISOString();
 const result=await supabase.from("card_invoice_confirmations").upsert({
  owner_id:user.id,card_id:cardId,reference_month:referenceMonth,
  official_amount:officialAmount,source:"manual_bank_confirmation",
  informed_at:informedAt,note:optionalText(data,"note",300),
 },{onConflict:"owner_id,card_id,reference_month"});
 if(result.error)throwSupabaseError(result.error,"confirmar valor da fatura","Nao foi possivel salvar o valor informado.");
 const invoice=await supabase.from("card_invoices")
  .select("id,workspace_id,calculated_invoice_total,paid_amount")
  .eq("owner_id",user.id).eq("card_id",cardId)
  .eq("reference_month",referenceMonth).maybeSingle();
 if(invoice.error)throwSupabaseError(invoice.error,"atualizar fatura","Valor confirmado, mas a fatura nao pode ser atualizada.");
 if(invoice.data){
  const calculated=Number(invoice.data.calculated_invoice_total??0);
  const difference=officialAmount-calculated;
  const updated=await supabase.from("card_invoices").update({
   confirmed_open_total:officialAmount,
   confirmed_open_total_at:informedAt,
   confirmed_open_total_source:"manual_bank_confirmation",
   total_amount:officialAmount,invoice_total:officialAmount,
   manual_invoice_total:officialAmount,confirmed_invoice_total:officialAmount,
   current_display_total:officialAmount,
   outstanding_amount:Math.max(0,officialAmount-Number(invoice.data.paid_amount??0)),
   source:"manual",total_source:"manual_bank_confirmation",
   reconciliation_difference:difference,
   reconciliation_status:Math.abs(difference)<=.01?"matched":Math.abs(difference)<=1?"small_difference":"divergent",
  }).eq("id",invoice.data.id).eq("owner_id",user.id);
  if(updated.error)throwSupabaseError(updated.error,"atualizar fatura","Valor confirmado, mas a fatura nao pode ser atualizada.");
  invalidateOpenInvoiceCache([{
   cycleId:String(invoice.data.id),
   workspaceId:invoice.data.workspace_id??null,
  }]);
 }
 refreshFinance();
 redirect(`/financeiro/cartoes/${cardId}?toast=invoice-confirmed`);
}
