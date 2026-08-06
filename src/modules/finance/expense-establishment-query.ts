import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildEstablishmentAnalyses, type EstablishmentAnalysis, type EstablishmentDefinition, type EstablishmentTransaction } from "./expense-establishment-analysis";

type Relation<T> = T | T[] | null;
function one<T>(value: Relation<T>) { return Array.isArray(value) ? value[0] ?? null : value; }
function text(value: unknown) { return value === null || value === undefined ? null : String(value); }

export async function getExpenseEstablishmentAnalyses(supabase: SupabaseClient, workspaceId: string, month: string) {
  const [establishments, bankLinks, cardLinks, invoiceLinks, rules] = await Promise.all([
    supabase.from("expense_establishments").select("id,name,financial_categories(name)").eq("workspace_id", workspaceId).eq("status", "active").order("name"),
    supabase.from("expense_establishment_transactions").select("establishment_id,financial_transactions!inner(id,amount,competence_date,description,bank_direction,transaction_role,transaction_type,status,financial_accounts:financial_accounts!financial_transactions_account_id_fkey(name,institution_name),credit_cards:credit_cards!financial_transactions_credit_card_id_fkey(name,institution_name,last_four_digits))").eq("workspace_id", workspaceId).eq("is_active", true).not("transaction_id", "is", null),
    supabase.from("expense_establishment_transactions").select("establishment_id,card_purchases!inner(id,amount_brl,installment_amount,competence_date,purchase_date,description,transaction_role,status,credit_cards(name,institution_name,last_four_digits))").eq("workspace_id", workspaceId).eq("is_active", true).not("card_purchase_id", "is", null),
    supabase.from("expense_establishment_transactions").select("establishment_id,invoice_entries!inner(id,amount,amount_brl,transaction_date,description_raw,entry_type,review_status,credit_cards(name,institution_name,last_four_digits))").eq("workspace_id", workspaceId).eq("is_active", true).not("invoice_entry_id", "is", null),
    supabase.from("expense_establishment_rules").select("establishment_id,display_name").eq("workspace_id", workspaceId).eq("is_active", true).is("archived_at", null),
  ]);
  if (establishments.error) throw new Error("Nao foi possivel carregar os estabelecimentos.");
  if (bankLinks.error || cardLinks.error || invoiceLinks.error) throw new Error("Nao foi possivel carregar as movimentacoes reconhecidas.");
  if (rules.error) throw new Error("Nao foi possivel carregar as regras de reconhecimento.");
  const aliasesByEstablishment = new Map<string, string[]>();
  for (const rule of rules.data ?? []) {
    const id = String(rule.establishment_id); const aliases = aliasesByEstablishment.get(id) ?? [];
    if (rule.display_name) aliases.push(String(rule.display_name)); aliasesByEstablishment.set(id, aliases);
  }
  const definitions: EstablishmentDefinition[] = (establishments.data ?? []).map(row => {
    const category = one(row.financial_categories as Relation<{ name: string | null }>);
    return { id: String(row.id), name: String(row.name), categoryName: category?.name ?? null, aliases: [...new Set(aliasesByEstablishment.get(String(row.id)) ?? [])] };
  });
  const transactions: EstablishmentTransaction[] = [];
  for (const row of bankLinks.data ?? []) {
    const transaction = one(row.financial_transactions as Relation<Record<string, unknown>>); if (!transaction) continue;
    const account = one(transaction.financial_accounts as Relation<{ name: string | null; institution_name: string | null }>);
    const card = one(transaction.credit_cards as Relation<{ name: string | null; institution_name: string | null; last_four_digits: string | null }>);
    transactions.push({ id: String(transaction.id), establishmentId: String(row.establishment_id), date: String(transaction.competence_date ?? ""), amountCents: Math.round(Math.abs(Number(transaction.amount ?? 0)) * 100), description: String(transaction.description ?? "Movimentacao reconhecida"), sourceLabel: card ? [card.institution_name, card.name, card.last_four_digits ? `final ${card.last_four_digits}` : null].filter(Boolean).join(" · ") : [account?.institution_name, account?.name].filter(Boolean).join(" · ") || "Origem nao disponivel", bankDirection: text(transaction.bank_direction), transactionRole: text(transaction.transaction_role), transactionType: text(transaction.transaction_type), status: text(transaction.status) });
  }
  for (const row of cardLinks.data ?? []) {
    const purchase = one(row.card_purchases as Relation<Record<string, unknown>>); if (!purchase) continue;
    const card = one(purchase.credit_cards as Relation<{ name: string | null; institution_name: string | null; last_four_digits: string | null }>);
    transactions.push({ id: String(purchase.id), establishmentId: String(row.establishment_id), date: String(purchase.competence_date ?? purchase.purchase_date ?? ""), amountCents: Math.round(Math.abs(Number(purchase.amount_brl ?? purchase.installment_amount ?? 0)) * 100), description: String(purchase.description ?? "Compra no cartao"), sourceLabel: [card?.institution_name, card?.name, card?.last_four_digits ? `final ${card.last_four_digits}` : null].filter(Boolean).join(" · ") || "Cartao", bankDirection: "outflow", transactionRole: text(purchase.transaction_role), transactionType: "expense", status: text(purchase.status) });
    const aliases = aliasesByEstablishment.get(String(row.establishment_id)) ?? [];
    aliases.push(String(purchase.description ?? ""));
    aliasesByEstablishment.set(String(row.establishment_id), aliases.filter(Boolean));
  }
  for (const row of invoiceLinks.data ?? []) {
    const entry = one(row.invoice_entries as Relation<Record<string, unknown>>); if (!entry) continue;
    const card = one(entry.credit_cards as Relation<{ name: string | null; institution_name: string | null; last_four_digits: string | null }>);
    transactions.push({ id: String(entry.id), establishmentId: String(row.establishment_id), date: String(entry.transaction_date ?? ""), amountCents: Math.round(Math.abs(Number(entry.amount_brl ?? entry.amount ?? 0)) * 100), description: String(entry.description_raw ?? "Compra no cartao"), sourceLabel: [card?.institution_name, card?.name, card?.last_four_digits ? `final ${card.last_four_digits}` : null].filter(Boolean).join(" · ") || "Cartao", bankDirection: "outflow", transactionRole: ["purchase", "installment_purchase"].includes(String(entry.entry_type)) ? "consumption" : String(entry.entry_type), transactionType: "expense", status: text(entry.review_status) });
    const aliases = aliasesByEstablishment.get(String(row.establishment_id)) ?? [];
    aliases.push(String(entry.description_raw ?? ""));
    aliasesByEstablishment.set(String(row.establishment_id), aliases.filter(Boolean));
  }
  const linkedEstablishmentIds = new Set(transactions.map(transaction => transaction.establishmentId));
  const linkedDefinitions = definitions.filter(item => linkedEstablishmentIds.has(item.id)).map(item => ({
    ...item,
    aliases: [...new Set(aliasesByEstablishment.get(item.id) ?? [])],
  }));
  return buildEstablishmentAnalyses({ establishments: linkedDefinitions, transactions, selectedMonth: month, currentMonth: new Date().toISOString().slice(0, 7) }) satisfies EstablishmentAnalysis[];
}
