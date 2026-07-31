import type { SupabaseClient } from "@supabase/supabase-js";
import { moneyToCents } from "./commitments";

export type RecurringCommitmentSuggestion = {
  fingerprint: string;
  merchant: string;
  probableFrequency: "monthly" | "other";
  averageAmountCents: number;
  accountId: string | null;
  occurrenceCount: number;
  confidence: number;
};

const normalize = (value: string) =>
  value.normalize("NFD").replace(/\p{Diacritic}/gu, "")
    .toLocaleUpperCase("pt-BR").replace(/\s+/g, " ").trim();

export async function getRecurringCommitmentSuggestions(
  supabase: SupabaseClient,
  input: { workspaceId: string; userId: string; months?: number },
): Promise<RecurringCommitmentSuggestion[]> {
  const from = new Date();
  from.setUTCMonth(from.getUTCMonth() - (input.months ?? 12));
  const [transactions, commitments, decisions] = await Promise.all([
    supabase.from("financial_transactions")
      .select("merchant,description,amount,competence_date,account_id")
      .or(`workspace_id.eq.${input.workspaceId},and(workspace_id.is.null,owner_id.eq.${input.userId})`)
      .gte("competence_date", from.toISOString().slice(0, 10))
      .order("competence_date"),
    supabase.from("financial_commitments")
      .select("title,merchant_match_pattern")
      .eq("workspace_id", input.workspaceId).is("archived_at", null),
    supabase.from("commitment_match_decisions").select("fingerprint")
      .eq("workspace_id", input.workspaceId).eq("decision", "rejected"),
  ]);
  if (transactions.error || commitments.error || decisions.error) return [];
  const existingPatterns = new Set((commitments.data ?? []).flatMap(item =>
    [item.title, item.merchant_match_pattern].filter(Boolean)
      .map(value => normalize(String(value)))
  ));
  const rejected = new Set((decisions.data ?? []).map(item =>
    String(item.fingerprint)
  ));
  const groups = new Map<string, Array<{
    amountCents: number;
    date: string;
    accountId: string | null;
  }>>();
  for (const row of transactions.data ?? []) {
    const merchant = normalize(String(row.merchant || row.description || ""));
    if (!merchant || existingPatterns.has(merchant)) continue;
    const group = groups.get(merchant) ?? [];
    group.push({
      amountCents: Math.abs(moneyToCents(row.amount) ?? 0),
      date: String(row.competence_date),
      accountId: row.account_id ? String(row.account_id) : null,
    });
    groups.set(merchant, group);
  }
  return [...groups.entries()].flatMap(([merchant, rows]) => {
    if (rows.length < 3) return [];
    const uniqueMonths = new Set(rows.map(row => row.date.slice(0, 7))).size;
    if (uniqueMonths < 3) return [];
    const fingerprint = `recurring:${merchant}`;
    if (rejected.has(fingerprint)) return [];
    const amounts = rows.map(row => row.amountCents);
    const averageAmountCents = Math.round(
      amounts.reduce((sum, value) => sum + value, 0) / amounts.length,
    );
    const deviation = amounts.reduce((sum, value) =>
      sum + Math.abs(value - averageAmountCents), 0) / amounts.length;
    const regularity = Math.min(1, uniqueMonths / Math.max(rows.length, 1));
    const valueStability = averageAmountCents
      ? Math.max(0, 1 - deviation / averageAmountCents)
      : 0;
    const confidence = Math.round(
      Math.min(0.98, 0.55 + regularity * 0.25 + valueStability * 0.18) * 100,
    ) / 100;
    return [{
      fingerprint,
      merchant,
      probableFrequency: uniqueMonths >= rows.length - 1
        ? "monthly" as const
        : "other" as const,
      averageAmountCents,
      accountId: rows.find(row => row.accountId)?.accountId ?? null,
      occurrenceCount: rows.length,
      confidence,
    }];
  }).sort((left, right) => right.confidence - left.confidence).slice(0, 8);
}

export const getCommitmentSuggestions = getRecurringCommitmentSuggestions;
