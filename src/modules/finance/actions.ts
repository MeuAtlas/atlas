"use server";

import { revalidatePath } from "next/cache";
import { throwSupabaseError } from "@/lib/errors";
import { requireFinanceAccess } from "./access";
import { amountField, dateField, enumField, optionalText, textField } from "./validation";

function refreshFinance() {
  revalidatePath("/financeiro");
  revalidatePath("/financeiro/movimentacoes");
  revalidatePath("/financeiro/contas");
  revalidatePath("/financeiro/cartoes");
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
