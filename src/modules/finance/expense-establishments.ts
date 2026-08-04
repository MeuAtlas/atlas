import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { calculateExpenseEstablishmentMetrics } from "./expense-establishment-metrics";

type EstablishmentRow = {
  id: string;
  name: string;
  reference_daily_amount: number | null;
  planning_enabled: boolean;
  financial_categories?: { name?: string | null } | Array<{ name?: string | null }> | null;
};

type LinkedTransactionRow = {
  entity_id?: string;
  establishment_id: string;
  financial_transactions?: {
    amount?: number | null;
    competence_date?: string | null;
    bank_direction?: string | null;
    status?: string | null;
  } | Array<{
    amount?: number | null;
    competence_date?: string | null;
    bank_direction?: string | null;
    status?: string | null;
  }> | null;
};

export type ExpenseEstablishmentContext = {
  id: string;
  name: string;
  categoryName: string;
  referenceDailyAmount: number | null;
  planningEnabled: boolean;
  paymentCount: number;
  currentMonthTotal: number;
  last12MonthsTotal: number;
  averagePayment: number;
  medianMonthly: number;
  observedMonths: number;
};

function relation<T>(value: T | T[] | null | undefined) {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

export async function getMovementExpenseEstablishmentContexts(
  supabase: SupabaseClient,
  workspaceId: string,
  transactionIds: string[],
) {
  if (!transactionIds.length) return {} as Record<string, ExpenseEstablishmentContext>;
  const links = await supabase.from("expense_establishment_transactions").select(
    "transaction_id,establishment_id,expense_establishments!inner(id,name,reference_daily_amount,planning_enabled,financial_categories(name))",
  ).eq("workspace_id", workspaceId).eq("is_active", true)
    .in("transaction_id", transactionIds);
  if (links.error || !links.data?.length) {
    return {} as Record<string, ExpenseEstablishmentContext>;
  }
  const establishmentIds = [...new Set(links.data.map(row => String(row.establishment_id)))];
  const historyStart = new Date();
  historyStart.setUTCMonth(historyStart.getUTCMonth() - 11, 1);
  const history = await supabase.from("expense_establishment_transactions").select(
    "establishment_id,financial_transactions!inner(amount,competence_date,bank_direction,status)",
  ).eq("workspace_id", workspaceId).eq("is_active", true)
    .in("establishment_id", establishmentIds)
    .gte("financial_transactions.competence_date", historyStart.toISOString().slice(0, 10));
  const historyByEstablishment = new Map<string, Array<{ amount: number; date: string }>>();
  for (const raw of (history.data ?? []) as unknown as LinkedTransactionRow[]) {
    const transaction = relation(raw.financial_transactions);
    if (!transaction || transaction.bank_direction !== "outflow" ||
      ["cancelled", "disputed"].includes(String(transaction.status ?? ""))) continue;
    const rows = historyByEstablishment.get(String(raw.establishment_id)) ?? [];
    rows.push({
      amount: Number(transaction.amount ?? 0),
      date: String(transaction.competence_date ?? ""),
    });
    historyByEstablishment.set(String(raw.establishment_id), rows);
  }
  const result: Record<string, ExpenseEstablishmentContext> = {};
  for (const raw of links.data) {
    const establishment = relation(
      raw.expense_establishments as unknown as EstablishmentRow | EstablishmentRow[],
    );
    if (!establishment) continue;
    const category = relation(establishment.financial_categories);
    result[String(raw.transaction_id)] = {
      id: String(establishment.id),
      name: String(establishment.name),
      categoryName: String(category?.name ?? "Sem categoria"),
      referenceDailyAmount: establishment.reference_daily_amount === null
        ? null
        : Number(establishment.reference_daily_amount),
      planningEnabled: Boolean(establishment.planning_enabled),
      ...calculateExpenseEstablishmentMetrics(
        historyByEstablishment.get(String(establishment.id)) ?? [],
      ),
    };
  }
  return result;
}
