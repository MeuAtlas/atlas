import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { calculateExpenseEstablishmentMetrics } from "./expense-establishment-metrics";

type EstablishmentRow = { id: string; name: string; planning_enabled: boolean; financial_categories?: { name?: string | null } | Array<{ name?: string | null }> | null };
type ContextLink = { transaction_id?: string | null; card_purchase_id?: string | null; invoice_entry_id?: string | null; establishment_id: string; expense_establishments?: EstablishmentRow | EstablishmentRow[] | null };
type HistoryRow = { establishment_id: string; financial_transactions?: { amount?: number | null; competence_date?: string | null; bank_direction?: string | null; status?: string | null } | Array<{ amount?: number | null; competence_date?: string | null; bank_direction?: string | null; status?: string | null }> | null; card_purchases?: { amount_brl?: number | null; installment_amount?: number | null; competence_date?: string | null; purchase_date?: string | null; transaction_role?: string | null; status?: string | null } | Array<{ amount_brl?: number | null; installment_amount?: number | null; competence_date?: string | null; purchase_date?: string | null; transaction_role?: string | null; status?: string | null }> | null; invoice_entries?: { amount?: number | null; amount_brl?: number | null; transaction_date?: string | null; entry_type?: string | null; review_status?: string | null } | Array<{ amount?: number | null; amount_brl?: number | null; transaction_date?: string | null; entry_type?: string | null; review_status?: string | null }> | null };
export type ExpenseEstablishmentContext = { id: string; name: string; categoryName: string; planningEnabled: boolean; paymentCount: number; currentMonthTotal: number; last12MonthsTotal: number; averagePayment: number; medianMonthly: number; observedMonths: number };
function relation<T>(value: T | T[] | null | undefined) { return Array.isArray(value) ? value[0] ?? null : value ?? null; }

export async function getMovementExpenseEstablishmentContexts(supabase: SupabaseClient, workspaceId: string, sourceIds: { transactionIds: string[]; cardPurchaseIds: string[]; invoiceEntryIds: string[] }) {
  const { transactionIds, cardPurchaseIds, invoiceEntryIds } = sourceIds;
  if (!transactionIds.length && !cardPurchaseIds.length && !invoiceEntryIds.length) return {} as Record<string, ExpenseEstablishmentContext>;
  const select = "transaction_id,card_purchase_id,invoice_entry_id,establishment_id,expense_establishments!inner(id,name,planning_enabled,financial_categories(name))";
  const [bankLinks, cardLinks, invoiceLinks] = await Promise.all([
    transactionIds.length ? supabase.from("expense_establishment_transactions").select(select).eq("workspace_id", workspaceId).eq("is_active", true).in("transaction_id", transactionIds) : Promise.resolve({ data: [], error: null }),
    cardPurchaseIds.length ? supabase.from("expense_establishment_transactions").select(select).eq("workspace_id", workspaceId).eq("is_active", true).in("card_purchase_id", cardPurchaseIds) : Promise.resolve({ data: [], error: null }),
    invoiceEntryIds.length ? supabase.from("expense_establishment_transactions").select(select).eq("workspace_id", workspaceId).eq("is_active", true).in("invoice_entry_id", invoiceEntryIds) : Promise.resolve({ data: [], error: null }),
  ]);
  const links = [...(bankLinks.data ?? []), ...(cardLinks.data ?? []), ...(invoiceLinks.data ?? [])] as ContextLink[];
  if (!links.length) return {} as Record<string, ExpenseEstablishmentContext>;
  const establishmentIds = [...new Set(links.map(row => String(row.establishment_id)))];
  const historyStart = new Date(); historyStart.setUTCMonth(historyStart.getUTCMonth() - 11, 1);
  const startDate = historyStart.toISOString().slice(0, 10);
  const [bankHistory, cardHistory, invoiceHistory] = await Promise.all([
    supabase.from("expense_establishment_transactions").select("establishment_id,financial_transactions!inner(amount,competence_date,bank_direction,status)").eq("workspace_id", workspaceId).eq("is_active", true).in("establishment_id", establishmentIds).gte("financial_transactions.competence_date", startDate),
    supabase.from("expense_establishment_transactions").select("establishment_id,card_purchases!inner(amount_brl,installment_amount,competence_date,purchase_date,transaction_role,status)").eq("workspace_id", workspaceId).eq("is_active", true).in("establishment_id", establishmentIds).gte("card_purchases.competence_date", startDate),
    supabase.from("expense_establishment_transactions").select("establishment_id,invoice_entries!inner(amount,amount_brl,transaction_date,entry_type,review_status)").eq("workspace_id", workspaceId).eq("is_active", true).in("establishment_id", establishmentIds).gte("invoice_entries.transaction_date", startDate),
  ]);
  const historyByEstablishment = new Map<string, Array<{ amount: number; date: string }>>();
  for (const raw of (bankHistory.data ?? []) as unknown as HistoryRow[]) {
    const item = relation(raw.financial_transactions);
    if (!item || item.bank_direction !== "outflow" || ["cancelled", "disputed"].includes(String(item.status ?? ""))) continue;
    const rows = historyByEstablishment.get(String(raw.establishment_id)) ?? [];
    rows.push({ amount: Number(item.amount ?? 0), date: String(item.competence_date ?? "") }); historyByEstablishment.set(String(raw.establishment_id), rows);
  }
  for (const raw of (cardHistory.data ?? []) as unknown as HistoryRow[]) {
    const item = relation(raw.card_purchases);
    if (!item || item.transaction_role !== "consumption" || ["cancelled", "disputed"].includes(String(item.status ?? ""))) continue;
    const rows = historyByEstablishment.get(String(raw.establishment_id)) ?? [];
    rows.push({ amount: Number(item.amount_brl ?? item.installment_amount ?? 0), date: String(item.competence_date ?? item.purchase_date ?? "") }); historyByEstablishment.set(String(raw.establishment_id), rows);
  }
  for (const raw of (invoiceHistory.data ?? []) as unknown as HistoryRow[]) {
    const item = relation(raw.invoice_entries);
    if (!item || !["purchase", "installment_purchase"].includes(String(item.entry_type))) continue;
    const rows = historyByEstablishment.get(String(raw.establishment_id)) ?? [];
    rows.push({ amount: Number(item.amount_brl ?? item.amount ?? 0), date: String(item.transaction_date ?? "") }); historyByEstablishment.set(String(raw.establishment_id), rows);
  }
  const result: Record<string, ExpenseEstablishmentContext> = {};
  for (const raw of links) {
    const establishment = relation(raw.expense_establishments); if (!establishment) continue;
    const category = relation(establishment.financial_categories);
    const sourceId = raw.transaction_id ?? raw.card_purchase_id ?? raw.invoice_entry_id;
    const contextKey = raw.invoice_entry_id ? `invoice-entry:${sourceId}` : sourceId;
    if (contextKey) result[String(contextKey)] = { id: String(establishment.id), name: String(establishment.name), categoryName: String(category?.name ?? "Sem categoria"), planningEnabled: Boolean(establishment.planning_enabled), ...calculateExpenseEstablishmentMetrics(historyByEstablishment.get(String(establishment.id)) ?? []) };
  }
  return result;
}
