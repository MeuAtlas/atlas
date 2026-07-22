"use server";

import { revalidatePath } from "next/cache";
import { throwSupabaseError } from "@/lib/errors";
import { requireFinanceAccess } from "./access";
import { amountField, dateField, enumField, optionalText, textField } from "./validation";
import { buildLoanProjections } from "@/lib/pluggy/loan-projections";

function refreshFinance() {
  revalidatePath("/financeiro");
  revalidatePath("/financeiro/movimentacoes");
  revalidatePath("/financeiro/contas");
  revalidatePath("/financeiro/cartoes");
  revalidatePath("/financeiro/emprestimos");
}

function optionalAmount(data:FormData,key:string){const raw=String(data.get(key)??"").trim().replace(",", ".");if(!raw)return null;const value=Number(raw);if(!Number.isFinite(value)||value<0)throw new Error(`Valor inválido em ${key}.`);return value}
function optionalInteger(data:FormData,key:string){const value=optionalAmount(data,key);if(value===null)return null;if(!Number.isInteger(value))throw new Error(`Quantidade inválida em ${key}.`);return value}

export async function createLoan(data:FormData){
 const {supabase,user}=await requireFinanceAccess();const externalId=crypto.randomUUID();const payroll=data.get("payroll_deducted")==="on";const total=optionalInteger(data,"installment_count");const paid=optionalInteger(data,"installments_paid")??0;if(total!==null&&paid>total)throw new Error("Parcelas pagas não podem superar o total.");const contracted=optionalAmount(data,"contracted_amount");const outstanding=optionalAmount(data,"outstanding_balance");const finalDue=optionalText(data,"final_due_date",10);
 const row={owner_id:user.id,workspace_id:null,bank_connection_id:null,source:"manual",external_id:externalId,name:textField(data,"name"),institution_name:optionalText(data,"institution_name"),loan_type:textField(data,"loan_type",80),subtype:null,contracted_amount:contracted,outstanding_balance:outstanding,installment_amount:optionalAmount(data,"installment_amount"),installment_count:total,installments_paid:paid,installments_remaining:total===null?null:total-paid,interest_rate:(optionalAmount(data,"interest_rate")??0)/100||null,effective_cost_rate:null,contract_date:null,first_installment_date:optionalText(data,"first_installment_date",10),next_installment_date:null,final_due_date:finalDue,payroll_deducted:payroll,payment_source:payroll?"payroll":"other",currency:"BRL",status:"active",visibility:"private",notes:optionalText(data,"notes",1000),raw_metadata:{manual:true},provider_metadata:{manual:true},original_amount:contracted,balance_due:outstanding,installments:total,start_date:null,end_date:finalDue};
 const inserted=await supabase.from("financial_loans").insert(row).select("id").single();if(inserted.error)throwSupabaseError(inserted.error,"criar emprestimo (financial_loans)","Não foi possível cadastrar o empréstimo.");const projections=buildLoanProjections({loanId:String(inserted.data.id),ownerId:user.id,externalId,name:row.name,installmentAmount:row.installment_amount,installmentCount:total,installmentsPaid:paid,installmentsRemaining:row.installments_remaining,firstInstallmentDate:row.first_installment_date,finalDueDate:row.final_due_date,payrollDeducted:payroll,source:"manual"});if(projections.length){const forecast=await supabase.from("financial_transactions").upsert(projections,{onConflict:"owner_id,source,external_id"});if(forecast.error)throwSupabaseError(forecast.error,"projetar parcelas (financial_transactions)","O contrato foi salvo, mas as parcelas não puderam ser projetadas.")}refreshFinance();
}

export async function createAccount(data: FormData) {
  const { supabase, user } = await requireFinanceAccess();
  const opening = Number(String(data.get("opening_balance") ?? "0").replace(",", ".")) || 0;
  const result = await supabase.from("financial_accounts").insert({
    owner_id: user.id,
    name: textField(data, "name"),
    institution_name: optionalText(data, "institution_name"),
    account_type: enumField(data, "account_type", ["checking", "savings", "digital", "cash", "investment", "international", "other"] as const),
    opening_balance: opening,
    current_balance: opening,
    visibility: "private",
    source: "manual",
  });
  if (result.error) throwSupabaseError(result.error, "criar conta (financial_accounts)", "Não foi possível criar a conta.");
  refreshFinance();
}

export async function archiveAccount(data: FormData) {
  const { supabase, user } = await requireFinanceAccess();
  const result = await supabase.from("financial_accounts").update({ status: "archived" }).eq("id", textField(data, "id", 40)).eq("owner_id", user.id);
  if (result.error) throwSupabaseError(result.error, "arquivar conta (financial_accounts)", "Não foi possível arquivar a conta.");
  refreshFinance();
}

export async function createTransaction(data: FormData) {
  const { supabase, user } = await requireFinanceAccess();
  const type = enumField(data, "transaction_type", ["income", "expense", "transfer"] as const);
  const accountId = textField(data, "account_id", 40);
  const destination = type === "transfer" ? textField(data, "destination_account_id", 40) : null;
  if (type === "transfer" && destination === accountId) throw new Error("Selecione contas diferentes.");
  const status = enumField(data, "status", ["forecast", "pending", "realized"] as const);
  const result = await supabase.from("financial_transactions").insert({
    owner_id: user.id,
    account_id: accountId,
    destination_account_id: destination,
    category_id: optionalText(data, "category_id", 40),
    transaction_type: type,
    status,
    description: textField(data, "description"),
    amount: amountField(data),
    competence_date: dateField(data, "competence_date"),
    due_date: optionalText(data, "due_date", 10),
    realized_at: status === "realized" ? new Date().toISOString() : null,
    visibility: "private",
    source: "manual",
    transfer_group_id: type === "transfer" ? crypto.randomUUID() : null,
  });
  if (result.error) throwSupabaseError(result.error, "criar movimentação (financial_transactions)", "Não foi possível salvar a movimentação.");
  refreshFinance();
}

export async function updateTransactionStatus(data: FormData) {
  const { supabase, user } = await requireFinanceAccess();
  const status = enumField(data, "status", ["realized", "cancelled"] as const);
  const result = await supabase.from("financial_transactions").update({ status, realized_at: status === "realized" ? new Date().toISOString() : null }).eq("id", textField(data, "id", 40)).eq("owner_id", user.id);
  if (result.error) throwSupabaseError(result.error, "atualizar movimentação (financial_transactions)", "Não foi possível atualizar a movimentação.");
  refreshFinance();
}

export async function deleteTransaction(data: FormData) {
  const { supabase, user } = await requireFinanceAccess();
  const result = await supabase.from("financial_transactions").delete().eq("id", textField(data, "id", 40)).eq("owner_id", user.id);
  if (result.error) throwSupabaseError(result.error, "excluir movimentação (financial_transactions)", "Não foi possível excluir a movimentação.");
  refreshFinance();
}

export async function createCard(data: FormData) {
  const { supabase, user } = await requireFinanceAccess();
  const result = await supabase.from("credit_cards").insert({ owner_id: user.id, name: textField(data, "name"), institution_name: optionalText(data, "institution_name"), last_four_digits: optionalText(data, "last_four_digits", 4), brand: optionalText(data, "brand", 30), credit_limit: amountField(data, "credit_limit"), closing_day: Number(textField(data, "closing_day", 2)), due_day: Number(textField(data, "due_day", 2)), linked_account_id: optionalText(data, "linked_account_id", 40), visibility: "private", source: "manual" });
  if (result.error) throwSupabaseError(result.error, "criar cartão (credit_cards)", "Não foi possível criar o cartão.");
  refreshFinance();
}

export async function archiveCard(data: FormData) {
  const { supabase, user } = await requireFinanceAccess();
  const result = await supabase.from("credit_cards").update({ status: "archived" }).eq("id", textField(data, "id", 40)).eq("owner_id", user.id);
  if (result.error) throwSupabaseError(result.error, "arquivar cartão (credit_cards)", "Não foi possível arquivar o cartão.");
  refreshFinance();
}
