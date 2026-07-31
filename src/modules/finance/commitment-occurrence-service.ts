import type { SupabaseClient } from "@supabase/supabase-js";
import { throwSupabaseError } from "@/lib/errors";
import {
  centsToMoney,
  generateCommitmentOccurrences,
  type FinancialCommitment,
} from "./commitments";

const rollingCommitmentTypes = new Set([
  "recurring",
  "subscription",
  "payroll_deduction",
]);

const isoDate = (date: Date) => date.toISOString().slice(0, 10);

export function rollingOccurrenceHorizon(today: string) {
  const end = new Date(`${today.slice(0, 7)}-01T12:00:00Z`);
  end.setUTCMonth(end.getUTCMonth() + 2);
  end.setUTCDate(0);
  return isoDate(end);
}

export async function refreshCommitmentNextDueDate(input: {
  supabase: SupabaseClient;
  workspaceId: string;
  commitmentId: string;
}) {
  const nextResult = await input.supabase
    .from("financial_commitment_occurrences")
    .select("expected_due_date")
    .eq("workspace_id", input.workspaceId)
    .eq("commitment_id", input.commitmentId)
    .in("status", ["projected", "expected", "pending", "overdue", "partially_paid"])
    .is("linked_transaction_id", null)
    .is("linked_card_movement_id", null)
    .order("expected_due_date", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (nextResult.error) {
    throwSupabaseError(
      nextResult.error,
      "refreshCommitmentNextDueDate.next",
      "O pagamento foi atualizado, mas o próximo vencimento não pôde ser localizado.",
    );
  }
  const updated = await input.supabase.from("financial_commitments").update({
    next_due_date: nextResult.data?.expected_due_date ?? null,
  }).eq("id", input.commitmentId)
    .eq("workspace_id", input.workspaceId);
  if (updated.error) {
    throwSupabaseError(
      updated.error,
      "refreshCommitmentNextDueDate.update",
      "O pagamento foi atualizado, mas o próximo vencimento não pôde ser recalculado.",
    );
  }
}

function annualOccurrenceHorizon(today: string) {
  const end = new Date(`${today}T12:00:00Z`);
  end.setUTCMonth(end.getUTCMonth() + 12);
  return isoDate(end);
}

export async function persistCommitmentOccurrences(input: {
  supabase: SupabaseClient;
  userId: string;
  commitment: FinancialCommitment;
  today?: string;
  includeStartDate?: boolean;
}) {
  const today = input.today ?? isoDate(new Date());
  const rolling = rollingCommitmentTypes.has(
    input.commitment.commitmentType,
  );
  const until = rolling
    ? rollingOccurrenceHorizon(today)
    : annualOccurrenceHorizon(today);

  let pruned = 0;
  if (rolling) {
    const prunedResult = await input.supabase
      .from("financial_commitment_occurrences")
      .delete({ count: "exact" })
      .eq("workspace_id", input.commitment.workspaceId)
      .eq("commitment_id", input.commitment.id)
      .gt("expected_due_date", until)
      .in("status", ["projected", "expected", "pending"])
      .is("linked_transaction_id", null)
      .is("linked_card_movement_id", null);
    if (prunedResult.error) {
      throwSupabaseError(
        prunedResult.error,
        "persistCommitmentOccurrences.prune",
        "Não foi possível ajustar o horizonte das ocorrências.",
      );
    }
    pruned = prunedResult.count ?? 0;
  }

  const existingResult = await input.supabase
    .from("financial_commitment_occurrences")
    .select("commitment_id,competence_month,sequence_number")
    .eq("commitment_id", input.commitment.id);
  if (existingResult.error) {
    throwSupabaseError(
      existingResult.error,
      "persistCommitmentOccurrences.existing",
      "Não foi possível verificar as ocorrências existentes.",
    );
  }
  const existing = new Set((existingResult.data ?? []).map(row =>
    `${row.commitment_id}:${row.competence_month}:${row.sequence_number}`
  ));
  const currentMonth = `${today.slice(0, 7)}-01`;
  const from = input.includeStartDate
    ? input.commitment.startDate
    : input.commitment.startDate > currentMonth
      ? input.commitment.startDate
      : currentMonth;
  const generated = generateCommitmentOccurrences({
    commitment: input.commitment,
    from,
    until,
    existingKeys: existing,
    today,
  });
  if (generated.length) {
    const inserted = await input.supabase
      .from("financial_commitment_occurrences")
      .upsert(generated.map(item => ({
        workspace_id: input.commitment.workspaceId,
        created_by: input.userId,
        commitment_id: input.commitment.id,
        competence_month: item.competenceMonth,
        sequence_number: item.sequenceNumber,
        expected_due_date: item.expectedDueDate,
        expected_amount: item.expectedAmountCents === null
          ? null
          : centsToMoney(item.expectedAmountCents),
        currency_code: input.commitment.currencyCode,
        status: item.status,
      })), {
        onConflict: "commitment_id,competence_month,sequence_number",
        ignoreDuplicates: true,
      });
    if (inserted.error) {
      throwSupabaseError(
        inserted.error,
        "persistCommitmentOccurrences.insert",
        "Não foi possível gerar as ocorrências.",
      );
    }
  }

  const nextResult = await input.supabase
    .from("financial_commitment_occurrences")
    .select("expected_due_date")
    .eq("workspace_id", input.commitment.workspaceId)
    .eq("commitment_id", input.commitment.id)
    .in("status", ["projected", "expected", "pending", "overdue", "partially_paid"])
    .order("expected_due_date", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (nextResult.error) {
    throwSupabaseError(
      nextResult.error,
      "persistCommitmentOccurrences.next",
      "As ocorrências foram geradas, mas o próximo vencimento não pôde ser localizado.",
    );
  }
  const updated = await input.supabase.from("financial_commitments").update({
    last_generated_until: until,
    next_due_date: nextResult.data?.expected_due_date ??
      input.commitment.nextDueDate,
  }).eq("id", input.commitment.id)
    .eq("workspace_id", input.commitment.workspaceId);
  if (updated.error) {
    throwSupabaseError(
      updated.error,
      "persistCommitmentOccurrences.update",
      "As ocorrências foram geradas, mas o horizonte não foi atualizado.",
    );
  }
  return { generated: generated.length, pruned, until };
}

/**
 * Mantém apenas a janela operacional curta do compromisso.
 * A operação é idempotente pela chave
 * commitment_id + competence_month + sequence_number.
 */
export async function ensureCommitmentOccurrenceWindow(
  input: Parameters<typeof persistCommitmentOccurrences>[0],
) {
  return persistCommitmentOccurrences(input);
}
