import type { SupabaseClient } from "@supabase/supabase-js";
import { throwSupabaseError } from "@/lib/errors";
import { calculatePersonExpenseNetCost } from "./person-reimbursements";

export type MovementPersonContext = {
  transactionId: string;
  personId: string;
  personName: string;
  flowRole: string | null;
  reimbursementRole: string | null;
  incomeEffect: string;
  reimbursementId: string | null;
  reimbursementStatus: string | null;
  reimbursementAmount: number;
  allocatedAmount: number;
  unallocatedAmount: number;
  pendingExpenses: Array<{
    id: string;
    description: string;
    pendingAmount: number;
  }>;
};

export type PersonPixSummary = {
  grossExpenseAmount: number;
  userResponsibilityAmount: number;
  personResponsibilityAmount: number;
  reimbursedAmount: number;
  pendingReimbursementAmount: number;
  netUserCost: number;
  pixSentAmount: number;
  pixReceivedAmount: number;
  counterparties: Array<{
    id: string;
    displayName: string;
    bankName: string | null;
    maskedIdentifier: string;
    directionScope: string;
    validFrom: string | null;
    isActive: boolean;
  }>;
};

export async function getMovementPersonContexts(
  supabase: SupabaseClient,
  workspaceId: string,
  transactionIds: string[],
): Promise<Record<string, MovementPersonContext>> {
  if (!transactionIds.length) return {};
  const [links, reimbursements] = await Promise.all([
    supabase.from("transaction_people").select(
      "transaction_id,person_id,financial_people(name),financial_transactions(person_flow_role,reimbursement_role,income_effect)",
    ).eq("workspace_id", workspaceId).in("transaction_id", transactionIds),
    supabase.from("financial_reimbursements").select(
      "id,incoming_transaction_id,person_id,amount,status,reimbursement_allocations(allocated_amount)",
    ).eq("workspace_id", workspaceId).in("incoming_transaction_id", transactionIds)
      .is("archived_at", null),
  ]);
  if (links.error || reimbursements.error) return {};
  const reimbursementByTransaction = new Map(
    (reimbursements.data ?? []).map(row => [String(row.incoming_transaction_id), row]),
  );
  const personIds = [...new Set(
    (links.data ?? []).map(row => String(row.person_id)),
  )];
  const pending = personIds.length
    ? await Promise.all([
      supabase.from("expense_allocations").select(
        "id,person_id,pending_reimbursement_amount,notes",
      ).eq("workspace_id", workspaceId).in("person_id", personIds)
        .gt("pending_reimbursement_amount", 0)
        .in("status", ["pending", "partially_reimbursed"]),
    ]).then(results => results[0])
    : { data: [], error: null };
  const result: Record<string, MovementPersonContext> = {};
  for (const raw of links.data ?? []) {
    const person = Array.isArray(raw.financial_people)
      ? raw.financial_people[0] : raw.financial_people;
    const transaction = Array.isArray(raw.financial_transactions)
      ? raw.financial_transactions[0] : raw.financial_transactions;
    const reimbursement = reimbursementByTransaction.get(String(raw.transaction_id));
    const allocations = reimbursement?.reimbursement_allocations ?? [];
    const allocatedAmount = allocations.reduce(
      (sum, item) => sum + Number(item.allocated_amount), 0,
    );
    result[String(raw.transaction_id)] = {
      transactionId: String(raw.transaction_id),
      personId: String(raw.person_id),
      personName: person?.name ?? "Pessoa",
      flowRole: transaction?.person_flow_role ?? null,
      reimbursementRole: transaction?.reimbursement_role ?? null,
      incomeEffect: transaction?.income_effect ?? "normal",
      reimbursementId: reimbursement?.id ?? null,
      reimbursementStatus: reimbursement?.status ?? null,
      reimbursementAmount: Number(reimbursement?.amount ?? 0),
      allocatedAmount,
      unallocatedAmount: Math.max(Number(reimbursement?.amount ?? 0) - allocatedAmount, 0),
      pendingExpenses: (pending.data ?? [])
        .filter(expense => expense.person_id === raw.person_id)
        .map(expense => ({
          id: String(expense.id),
          description: expense.notes || "Despesa compartilhada",
          pendingAmount: Number(expense.pending_reimbursement_amount),
        })),
    };
  }
  return result;
}

export async function getPersonPixSummary(
  supabase: SupabaseClient,
  input: {
    workspaceId: string;
    personId: string;
    from: string;
    to: string;
  },
): Promise<PersonPixSummary> {
  const [allocations, reimbursements, transactions, counterparties] =
    await Promise.all([
      supabase.from("expense_allocations").select(
        "allocation_role,allocated_amount,reimbursable_amount,reimbursed_amount,pending_reimbursement_amount,source_type,financial_transactions:financial_transactions!expense_allocations_source_transaction_id_fkey(competence_date),card_purchases:card_purchases!expense_allocations_source_card_movement_id_fkey(purchase_date),financial_commitment_occurrences:financial_commitment_occurrences!expense_allocations_source_commitment_occurrence_id_fkey(competence_month)",
      ).eq("workspace_id", input.workspaceId).eq("person_id", input.personId)
        .is("archived_at", null),
      supabase.from("financial_reimbursements").select("amount")
        .eq("workspace_id", input.workspaceId).eq("person_id", input.personId)
        .gte("received_date", input.from).lte("received_date", input.to)
        .neq("status", "cancelled").is("archived_at", null),
      supabase.from("transaction_people").select(
        "financial_transactions!inner(amount,competence_date,bank_direction,financial_nature)",
      ).eq("workspace_id", input.workspaceId).eq("person_id", input.personId)
        .gte("financial_transactions.competence_date", input.from)
        .lte("financial_transactions.competence_date", input.to),
      supabase.from("person_counterparties").select(
        "id,display_name,bank_name,masked_pix_key,masked_tax_number,account_masked,direction_scope,valid_from,is_active",
      ).eq("workspace_id", input.workspaceId).eq("person_id", input.personId)
        .is("archived_at", null).order("match_priority"),
    ]);
  const failure = [allocations, reimbursements, transactions, counterparties]
    .find(result => result.error);
  if (failure?.error) {
    throwSupabaseError(
      failure.error,
      "getPersonPixSummary",
      "Não foi possível carregar despesas compartilhadas e Pix.",
    );
  }
  const personRows = (allocations.data ?? []).filter(row => {
    const transaction = Array.isArray(row.financial_transactions)
      ? row.financial_transactions[0] : row.financial_transactions;
    const card = Array.isArray(row.card_purchases)
      ? row.card_purchases[0] : row.card_purchases;
    const occurrence = Array.isArray(row.financial_commitment_occurrences)
      ? row.financial_commitment_occurrences[0]
      : row.financial_commitment_occurrences;
    const sourceDate = transaction?.competence_date ?? card?.purchase_date ??
      occurrence?.competence_month ?? null;
    return !sourceDate || (sourceDate >= input.from && sourceDate <= input.to);
  });
  const beneficiaryGross = personRows
    .filter(row => row.allocation_role === "beneficiary")
    .reduce((sum, row) => sum + Number(row.allocated_amount), 0);
  const personResponsibility = personRows
    .filter(row => row.allocation_role === "shared_responsibility")
    .reduce((sum, row) => sum + Number(row.allocated_amount), 0);
  const reimbursed = personRows
    .filter(row => row.allocation_role === "shared_responsibility")
    .reduce((sum, row) => sum + Number(row.reimbursed_amount), 0);
  const pendingAmount = personRows
    .filter(row => row.allocation_role === "shared_responsibility")
    .reduce((sum, row) => sum + Number(row.pending_reimbursement_amount), 0);
  const userResponsibility = Math.max(beneficiaryGross - personResponsibility, 0);
  const net = calculatePersonExpenseNetCost({
    grossExpenseAmountCents: Math.round(beneficiaryGross * 100),
    userResponsibilityAmountCents: Math.round(userResponsibility * 100),
    otherPeopleResponsibilityAmountCents: Math.round(personResponsibility * 100),
    reimbursedAmountCents: Math.round(reimbursed * 100),
  });
  let pixSentAmount = 0;
  let pixReceivedAmount = 0;
  for (const row of transactions.data ?? []) {
    const transaction = Array.isArray(row.financial_transactions)
      ? row.financial_transactions[0] : row.financial_transactions;
    if (!transaction || !["pix_received", "pix_sent"].includes(
      transaction.financial_nature ?? "",
    )) continue;
    if (transaction.bank_direction === "inflow") {
      pixReceivedAmount += Number(transaction.amount);
    }
    if (transaction.bank_direction === "outflow") {
      pixSentAmount += Number(transaction.amount);
    }
  }
  return {
    grossExpenseAmount: beneficiaryGross,
    userResponsibilityAmount: userResponsibility,
    personResponsibilityAmount: personResponsibility,
    reimbursedAmount: reimbursed || (reimbursements.data ?? [])
      .reduce((sum, row) => sum + Number(row.amount), 0),
    pendingReimbursementAmount: pendingAmount,
    netUserCost: net.netUserCostCents / 100,
    pixSentAmount,
    pixReceivedAmount,
    counterparties: (counterparties.data ?? []).map(row => ({
      id: String(row.id),
      displayName: row.display_name || "Contraparte Pix",
      bankName: row.bank_name,
      maskedIdentifier:
        row.masked_pix_key || row.masked_tax_number || row.account_masked || "Identificador protegido",
      directionScope: row.direction_scope,
      validFrom: row.valid_from,
      isActive: row.is_active,
    })),
  };
}

export async function getSharedPlanningSummary(
  supabase: SupabaseClient,
  workspaceId: string,
  fromMonth: string,
  toMonth: string,
) {
  const result = await supabase.from("expense_allocations").select(
    "allocation_role,allocated_amount,reimbursable_amount,reimbursed_amount,source_commitment_occurrence_id,financial_commitment_occurrences:financial_commitment_occurrences!expense_allocations_source_commitment_occurrence_id_fkey!inner(competence_month)",
  ).eq("workspace_id", workspaceId)
    .gte("financial_commitment_occurrences.competence_month", fromMonth)
    .lte("financial_commitment_occurrences.competence_month", toMonth)
    .is("archived_at", null);
  if (result.error) return {
    grossAmount: 0, userResponsibility: 0, reimbursementExpected: 0,
    reimbursementReceived: 0, reimbursementPending: 0, netProjectedCost: 0,
    sharedExpenseCount: 0,
  };
  const rows = result.data ?? [];
  const grossAmount = rows.filter(row => row.allocation_role === "beneficiary")
    .reduce((sum, row) => sum + Number(row.allocated_amount), 0);
  const reimbursementExpected = rows
    .filter(row => row.allocation_role === "shared_responsibility")
    .reduce((sum, row) => sum + Number(row.reimbursable_amount), 0);
  const reimbursementReceived = rows
    .filter(row => row.allocation_role === "shared_responsibility")
    .reduce((sum, row) => sum + Number(row.reimbursed_amount), 0);
  const sharedExpenseCount = new Set(rows
    .filter(row => row.allocation_role === "shared_responsibility")
    .map(row => row.source_commitment_occurrence_id)).size;
  return {
    grossAmount,
    userResponsibility: Math.max(grossAmount - reimbursementExpected, 0),
    reimbursementExpected,
    reimbursementReceived,
    reimbursementPending: Math.max(reimbursementExpected - reimbursementReceived, 0),
    netProjectedCost: Math.max(grossAmount - reimbursementExpected, 0),
    sharedExpenseCount,
  };
}
