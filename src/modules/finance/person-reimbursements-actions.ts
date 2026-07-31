"use server";

import { createHash } from "node:crypto";
import { z } from "zod";
import { logSupabaseError, normalizeSupabaseError, throwSupabaseError } from "@/lib/errors";
import { requireFinanceAccess } from "./access";
import { invalidateCommitmentsCache } from "./commitments-cache";
import {
  calculateExpenseAllocations,
  matchPixCounterpartyToPerson,
  normalizeCounterpartyName,
  resolvePersonPixRole,
  suggestReimbursementMatches as buildReimbursementSuggestions,
  type PersonCounterpartyRule,
} from "./person-reimbursements";
import {
  getPersonPixSummary as queryPersonPixSummary,
} from "./person-reimbursements-query";

const uuid = z.string().uuid();
const optionalUuid = z.union([uuid, z.literal("")]).transform(value => value || null);
const positiveMoney = z.preprocess(value => {
  const normalized = String(value ?? "").trim().replace(/\./g, "").replace(",", ".");
  return normalized ? Number(normalized) : Number.NaN;
}, z.number().finite().positive());
const date = z.string().date();
const directionScope = z.enum(["both", "incoming_only", "outgoing_only"]);
const counterpartyType = z.enum([
  "pix_key", "tax_number", "bank_account", "provider_counterparty",
  "normalized_name", "composite", "other",
]);
const allocationType = z.enum(["full", "percentage", "fixed_amount", "remainder"]);

type Supabase = Awaited<ReturnType<typeof requireFinanceAccess>>["supabase"];

function nullable(value: FormDataEntryValue | null) {
  const text = String(value ?? "").trim();
  return text || null;
}
function checked(data: FormData, key: string) {
  return ["on", "true", "1"].includes(String(data.get(key) ?? ""));
}
function hashSensitive(value: string | null) {
  return value
    ? createHash("sha256").update(value.trim().toLocaleLowerCase("pt-BR")).digest("hex")
    : null;
}
function maskSensitive(value: string | null) {
  if (!value) return null;
  const compact = value.replace(/\s+/g, "");
  if (compact.length <= 4) return "••••";
  return `${compact.slice(0, 2)}••••${compact.slice(-2)}`;
}
function centsToMoney(cents: number) {
  return Math.round(cents) / 100;
}
function moneyToCents(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(Math.abs(parsed) * 100) : 0;
}

async function requireWorkspace(workspaceId: string) {
  const access = await requireFinanceAccess();
  const workspace = await access.supabase.from("workspaces")
    .select("id").eq("id", workspaceId).maybeSingle();
  if (workspace.error || !workspace.data) {
    throw new Error("Espaço financeiro inválido ou sem permissão.");
  }
  return access;
}

async function requirePerson(
  supabase: Supabase,
  workspaceId: string,
  personId: string,
) {
  const person = await supabase.from("financial_people").select("id,name")
    .eq("workspace_id", workspaceId).eq("id", personId)
    .is("archived_at", null).maybeSingle();
  if (person.error || !person.data) throw new Error("Pessoa não encontrada.");
  return person.data;
}

function safeMetadata(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function counterpartyFromTransaction(row: {
  description?: unknown;
  merchant?: unknown;
  provider_metadata?: unknown;
}) {
  const metadata = safeMetadata(row.provider_metadata);
  const counterparty = safeMetadata(metadata.counterparty);
  const displayName = String(
    counterparty.displayName ?? counterparty.name ?? row.merchant ??
    row.description ?? "",
  ).trim();
  return {
    displayName: displayName || null,
    normalizedName: normalizeCounterpartyName(displayName) || null,
    providerCounterpartyId: nullableValue(counterparty.providerCounterpartyId),
    taxNumberHash: nullableValue(counterparty.taxNumberHash),
    pixKeyHash: nullableValue(counterparty.pixKeyHash),
    bankCode: nullableValue(counterparty.bankCode),
    bankName: nullableValue(counterparty.bankName),
    branchMasked: nullableValue(counterparty.branchMasked),
    accountMasked: nullableValue(counterparty.accountMasked),
  };
}

function nullableValue(value: unknown) {
  const text = String(value ?? "").trim();
  return text || null;
}

function invalidate(workspaceId: string, personId?: string) {
  invalidateCommitmentsCache(workspaceId, personId ? { personId } : {});
}

export async function createPersonCounterparty(data: FormData) {
  const workspaceId = uuid.parse(data.get("workspace_id"));
  const personId = uuid.parse(data.get("person_id"));
  const transactionId = optionalUuid.parse(String(data.get("transaction_id") ?? ""));
  const { supabase, user } = await requireWorkspace(workspaceId);
  await requirePerson(supabase, workspaceId, personId);

  let extracted: ReturnType<typeof counterpartyFromTransaction> | null = null;
  let provider: string | null = nullable(data.get("provider"));
  if (transactionId) {
    const transaction = await supabase.from("financial_transactions").select(
      "id,description,merchant,provider_metadata,source",
    ).eq("id", transactionId).maybeSingle();
    if (transaction.error || !transaction.data) {
      throw new Error("Movimentação Pix não encontrada.");
    }
    extracted = counterpartyFromTransaction(transaction.data);
    provider = provider ?? transaction.data.source;
  }

  const rawPixKey = nullable(data.get("pix_key"));
  const rawTaxNumber = nullable(data.get("tax_number"));
  const displayName = nullable(data.get("display_name")) ?? extracted?.displayName;
  const normalizedName = normalizeCounterpartyName(
    nullable(data.get("normalized_name")) ?? displayName,
  ) || extracted?.normalizedName;
  const row = {
    workspace_id: workspaceId,
    person_id: personId,
    provider,
    counterparty_type: counterpartyType.parse(
      data.get("counterparty_type") || (
        extracted?.providerCounterpartyId ? "provider_counterparty" : "normalized_name"
      ),
    ),
    display_name: displayName,
    normalized_name: normalizedName,
    tax_number_hash: rawTaxNumber ? hashSensitive(rawTaxNumber) : extracted?.taxNumberHash,
    masked_tax_number: rawTaxNumber ? maskSensitive(rawTaxNumber) : null,
    pix_key_hash: rawPixKey ? hashSensitive(rawPixKey) : extracted?.pixKeyHash,
    masked_pix_key: rawPixKey ? maskSensitive(rawPixKey) : null,
    bank_code: nullable(data.get("bank_code")) ?? extracted?.bankCode,
    bank_name: nullable(data.get("bank_name")) ?? extracted?.bankName,
    branch_masked: nullable(data.get("branch_masked")) ?? extracted?.branchMasked,
    account_masked: nullable(data.get("account_masked")) ?? extracted?.accountMasked,
    provider_counterparty_id: nullable(data.get("provider_counterparty_id")) ??
      extracted?.providerCounterpartyId,
    direction_scope: directionScope.parse(data.get("direction_scope") || "both"),
    valid_from: nullable(data.get("valid_from")),
    is_active: true,
    manually_confirmed: true,
    reimbursement_match_mode: z.enum([
      "suggest", "never", "exact_amount", "explicit_commitment",
    ]).parse(data.get("reimbursement_match_mode") || "suggest"),
    reimbursement_commitment_id: optionalUuid.parse(
      String(data.get("reimbursement_commitment_id") ?? ""),
    ),
    created_by: user.id,
  };
  let saved = await supabase.from("person_counterparties")
    .insert(row).select("id").single();
  if (saved.error?.code === "23505") {
    let existing = supabase.from("person_counterparties").select("id")
      .eq("workspace_id", workspaceId)
      .eq("person_id", personId)
      .eq("counterparty_type", row.counterparty_type)
      .is("archived_at", null);
    for (const [column, value] of [
      ["provider_counterparty_id", row.provider_counterparty_id],
      ["tax_number_hash", row.tax_number_hash],
      ["pix_key_hash", row.pix_key_hash],
      ["bank_code", row.bank_code],
      ["account_masked", row.account_masked],
      ["normalized_name", row.normalized_name],
    ] as const) {
      existing = value === null || value === undefined
        ? existing.is(column, null)
        : existing.eq(column, value);
    }
    const match = await existing.maybeSingle();
    if (!match.error && match.data) {
      saved = await supabase.from("person_counterparties").update({
        display_name: row.display_name,
        direction_scope: row.direction_scope,
        valid_from: row.valid_from,
        is_active: true,
        manually_confirmed: true,
        reimbursement_match_mode: row.reimbursement_match_mode,
        reimbursement_commitment_id: row.reimbursement_commitment_id,
      }).eq("id", match.data.id).select("id").single();
    }
  }
  if (saved.error) {
    logSupabaseError(saved.error, "createPersonCounterparty");
    const normalized = normalizeSupabaseError(saved.error, "createPersonCounterparty");
    return {
      ok: false as const,
      message: "Não foi possível criar o vínculo Pix.",
      errorCode: normalized.code,
      debugMessage: process.env.NODE_ENV === "development"
        ? normalized.message
        : null,
    };
  }
  if (transactionId) {
    const link = new FormData();
    link.set("workspace_id", workspaceId);
    link.set("transaction_id", transactionId);
    link.set("person_id", personId);
    link.set("counterparty_id", String(saved.data.id));
    await linkTransactionToPerson(link);
  }
  if (checked(data, "apply_history")) {
    const history = new FormData();
    history.set("workspace_id", workspaceId);
    history.set("counterparty_id", String(saved.data.id));
    history.set("from", nullable(data.get("valid_from")) ?? "2000-01-01");
    history.set("to", new Date().toISOString().slice(0, 10));
    await applyCounterpartyToHistory(history);
  }
  invalidate(workspaceId, personId);
  return { ok: true as const, id: String(saved.data.id) };
}

export async function updatePersonCounterparty(data: FormData) {
  const workspaceId = uuid.parse(data.get("workspace_id"));
  const id = uuid.parse(data.get("counterparty_id"));
  const { supabase } = await requireWorkspace(workspaceId);
  const result = await supabase.from("person_counterparties").update({
    display_name: nullable(data.get("display_name")),
    normalized_name: normalizeCounterpartyName(nullable(data.get("display_name"))) || null,
    direction_scope: directionScope.parse(data.get("direction_scope") || "both"),
    valid_from: nullable(data.get("valid_from")),
    valid_until: nullable(data.get("valid_until")),
    is_active: !data.has("is_active") || checked(data, "is_active"),
    reimbursement_match_mode: z.enum([
      "suggest", "never", "exact_amount", "explicit_commitment",
    ]).parse(data.get("reimbursement_match_mode") || "suggest"),
    reimbursement_commitment_id: optionalUuid.parse(
      String(data.get("reimbursement_commitment_id") ?? ""),
    ),
  }).eq("workspace_id", workspaceId).eq("id", id).select("person_id").single();
  if (result.error) throw new Error("Não foi possível atualizar o vínculo Pix.");
  invalidate(workspaceId, result.data.person_id);
}

export async function archivePersonCounterparty(data: FormData) {
  const workspaceId = uuid.parse(data.get("workspace_id"));
  const id = uuid.parse(data.get("counterparty_id"));
  const { supabase } = await requireWorkspace(workspaceId);
  const result = await supabase.from("person_counterparties").update({
    is_active: false, archived_at: new Date().toISOString(),
  }).eq("workspace_id", workspaceId).eq("id", id).select("person_id").single();
  if (result.error) throw new Error("Não foi possível desativar o vínculo Pix.");
  invalidate(workspaceId, result.data.person_id);
}

export async function linkTransactionToPerson(data: FormData) {
  const workspaceId = uuid.parse(data.get("workspace_id"));
  const transactionId = uuid.parse(data.get("transaction_id"));
  const personId = uuid.parse(data.get("person_id"));
  const counterpartyId = optionalUuid.parse(
    String(data.get("counterparty_id") ?? ""),
  );
  const { supabase, user } = await requireWorkspace(workspaceId);
  await requirePerson(supabase, workspaceId, personId);
  const transaction = await supabase.from("financial_transactions").select(
    "id,bank_direction,financial_nature",
  ).eq("id", transactionId).maybeSingle();
  if (transaction.error || !transaction.data) {
    throw new Error("Movimentação não encontrada.");
  }
  const direction = transaction.data.bank_direction === "inflow"
    ? "incoming" : "outgoing";
  const role = resolvePersonPixRole({
    bankDirection: transaction.data.bank_direction ?? "review",
  });
  const link = await supabase.from("transaction_people").upsert({
    workspace_id: workspaceId,
    created_by: user.id,
    transaction_id: transactionId,
    person_id: personId,
    allocation_type: "full",
    allocation_value: 100,
    source: counterpartyId ? "rule" : "manual",
    manually_confirmed: !counterpartyId,
  }, { onConflict: "transaction_id,person_id" });
  if (link.error) throw new Error("Não foi possível vincular a pessoa.");
  const update = await supabase.from("financial_transactions").update({
    person_flow_role: role.personFlowRole,
  }).eq("id", transactionId);
  if (update.error) throw new Error("Pessoa vinculada, mas o papel do Pix não foi salvo.");
  invalidate(workspaceId, personId);
  return { direction, personFlowRole: role.personFlowRole };
}

export async function applyCounterpartyToHistory(data: FormData) {
  const workspaceId = uuid.parse(data.get("workspace_id"));
  const counterpartyId = uuid.parse(data.get("counterparty_id"));
  const from = date.parse(data.get("from") || "2000-01-01");
  const to = date.parse(data.get("to") || new Date().toISOString().slice(0, 10));
  const dryRun = checked(data, "dry_run");
  const { supabase, user } = await requireWorkspace(workspaceId);
  const counterpartyResult = await supabase.from("person_counterparties")
    .select("*").eq("workspace_id", workspaceId).eq("id", counterpartyId)
    .eq("is_active", true).is("archived_at", null).single();
  if (counterpartyResult.error) throw new Error("Vínculo Pix não encontrado.");
  const counterparty = counterpartyResult.data;
  const transactions = await supabase.from("financial_transactions").select(
    "id,description,merchant,provider_metadata,bank_direction,financial_nature,amount,competence_date",
  ).gte("competence_date", from).lte("competence_date", to)
    .or(`workspace_id.eq.${workspaceId},workspace_id.is.null`)
    .in("financial_nature", ["pix_received", "pix_sent"])
    .order("competence_date");
  if (transactions.error) throw new Error("Não foi possível analisar o histórico Pix.");

  const report = {
    analyzed: transactions.data.length,
    incoming: 0, outgoing: 0, linksCreated: 0, ambiguous: 0, rejected: 0,
    totalIncoming: 0, totalOutgoing: 0, possibleReimbursements: 0,
  };
  const rules: PersonCounterpartyRule[] = [{
    id: counterparty.id,
    personId: counterparty.person_id,
    providerCounterpartyId: counterparty.provider_counterparty_id,
    taxNumberHash: counterparty.tax_number_hash,
    pixKeyHash: counterparty.pix_key_hash,
    bankCode: counterparty.bank_code,
    accountMasked: counterparty.account_masked,
    normalizedName: counterparty.normalized_name,
    directionScope: counterparty.direction_scope,
    isActive: counterparty.is_active,
    manuallyConfirmed: counterparty.manually_confirmed,
    matchPriority: counterparty.match_priority,
  }];
  for (const transaction of transactions.data) {
    const direction = transaction.bank_direction === "inflow"
      ? "incoming" : transaction.bank_direction === "outflow" ? "outgoing" : null;
    if (!direction) { report.rejected++; continue; }
    const value = Number(transaction.amount);
    if (direction === "incoming") {
      report.incoming++; report.totalIncoming += value;
    } else {
      report.outgoing++; report.totalOutgoing += value;
    }
    const identity = counterpartyFromTransaction(transaction);
    const match = matchPixCounterpartyToPerson({
      counterparty: identity, rules, direction,
    });
    if (!match) { report.rejected++; continue; }
    if (!match.autoApplicable) {
      report.ambiguous++;
      if (!dryRun) {
        await supabase.from("person_transaction_match_suggestions").upsert({
          workspace_id: workspaceId,
          transaction_id: transaction.id,
          person_id: counterparty.person_id,
          counterparty_id: counterparty.id,
          suggestion_type: direction === "incoming"
            ? "incoming_person_payment" : "outgoing_person_payment",
          confidence: match.confidence,
          suggested_role: direction === "incoming"
            ? "received_from_person" : "sent_to_person",
          status: "pending",
          reason_metadata: { source: match.matchSource },
        });
      }
      continue;
    }
    if (!dryRun) {
      const linked = await supabase.from("transaction_people").upsert({
        workspace_id: workspaceId,
        created_by: user.id,
        transaction_id: transaction.id,
        person_id: counterparty.person_id,
        allocation_type: "full",
        allocation_value: 100,
        source: "rule",
        manually_confirmed: false,
      }, { onConflict: "transaction_id,person_id", ignoreDuplicates: true });
      if (linked.error) throw new Error("O backfill não pôde criar um vínculo.");
      const role = resolvePersonPixRole({
        bankDirection: transaction.bank_direction,
      });
      await supabase.from("financial_transactions")
        .update({ person_flow_role: role.personFlowRole }).eq("id", transaction.id);
    }
    report.linksCreated++;
    if (direction === "incoming") report.possibleReimbursements++;
  }
  if (!dryRun) invalidate(workspaceId, counterparty.person_id);
  return report;
}

export const applyCounterpartyRuleToHistoricalTransactions =
  applyCounterpartyToHistory;

export async function createExpenseAllocation(data: FormData) {
  const workspaceId = uuid.parse(data.get("workspace_id"));
  const sourceType = z.enum([
    "bank_transaction", "card_movement", "invoice_entry",
    "commitment_occurrence", "manual_expense",
  ]).parse(data.get("source_type"));
  const totalCents = moneyToCents(positiveMoney.parse(data.get("total_amount")));
  const rawRules = z.array(z.object({
    personId: uuid.nullable().optional(),
    responsiblePartyType: z.enum(["owner", "person"]).optional(),
    allocationType,
    allocationValue: z.number().finite().nonnegative(),
    reimbursable: z.boolean(),
    role: z.enum(["beneficiary", "responsible_party", "payer", "shared_responsibility"]),
  }).superRefine((rule, context) => {
    if ((rule.responsiblePartyType ?? "person") === "person" && !rule.personId) {
      context.addIssue({
        code: "custom",
        path: ["personId"],
        message: "Selecione a pessoa responsável.",
      });
    }
    if (rule.responsiblePartyType === "owner" && rule.personId) {
      context.addIssue({
        code: "custom",
        path: ["personId"],
        message: "A parte do titular não deve apontar para uma pessoa.",
      });
    }
  })).parse(JSON.parse(String(data.get("allocations") ?? "[]")));
  const calculated = calculateExpenseAllocations(totalCents, rawRules.map(rule => ({
    personId: rule.personId ?? "__workspace_owner__",
    allocationType: rule.allocationType,
    allocationValue: rule.allocationValue,
    reimbursable: rule.reimbursable,
  })));
  const { supabase, user } = await requireWorkspace(workspaceId);
  for (const rule of rawRules) {
    if (rule.personId) await requirePerson(supabase, workspaceId, rule.personId);
  }
  const sourceId = optionalUuid.parse(String(data.get("source_id") ?? ""));
  const rows = calculated.map((item, index) => ({
    workspace_id: workspaceId,
    source_type: sourceType,
    source_transaction_id: sourceType === "bank_transaction" ? sourceId : null,
    source_card_movement_id: sourceType === "card_movement" ? sourceId : null,
    source_invoice_entry_id: sourceType === "invoice_entry" ? sourceId : null,
    source_commitment_occurrence_id:
      sourceType === "commitment_occurrence" ? sourceId : null,
    person_id: rawRules[index].personId ?? null,
    responsible_party_type:
      rawRules[index].responsiblePartyType ?? "person",
    allocation_role: rawRules[index].role,
    allocation_type: item.allocationType,
    allocation_value: item.allocationType === "fixed_amount"
      ? centsToMoney(item.allocationValue) : item.allocationValue,
    allocated_amount: centsToMoney(item.allocatedAmountCents),
    reimbursable_amount: centsToMoney(item.reimbursableAmountCents),
    pending_reimbursement_amount: centsToMoney(item.reimbursableAmountCents),
    status: item.reimbursableAmountCents > 0 ? "pending" : "active",
    manually_confirmed: true,
    created_by: user.id,
  }));
  const result = await supabase.from("expense_allocations").upsert(rows);
  if (result.error) throw new Error("Não foi possível salvar a divisão da despesa.");
  invalidate(workspaceId);
}

export const updateExpenseAllocation = createExpenseAllocation;

export async function createReimbursement(data: FormData) {
  const workspaceId = uuid.parse(data.get("workspace_id"));
  const personId = uuid.parse(data.get("person_id"));
  const transactionId = optionalUuid.parse(
    String(data.get("incoming_transaction_id") ?? ""),
  );
  const amountValue = positiveMoney.parse(data.get("amount"));
  const { supabase, user } = await requireWorkspace(workspaceId);
  await requirePerson(supabase, workspaceId, personId);
  const inserted = await supabase.from("financial_reimbursements").insert({
    workspace_id: workspaceId,
    person_id: personId,
    incoming_transaction_id: transactionId,
    reimbursement_type: z.enum([
      "expense_reimbursement", "advance_return", "shared_expense_contribution",
      "refund", "repayment", "other",
    ]).parse(data.get("reimbursement_type") || "expense_reimbursement"),
    amount: amountValue,
    currency_code: String(data.get("currency_code") || "BRL").slice(0, 3),
    received_date: date.parse(data.get("received_date")),
    status: "unallocated",
    source: z.enum([
      "pix_auto_match", "manual", "movement_action",
      "commitment_match", "system_suggestion",
    ]).parse(data.get("source") || "manual"),
    notes: nullable(data.get("notes")),
    manually_confirmed: checked(data, "manually_confirmed"),
    created_by: user.id,
  }).select("id").single();
  if (inserted.error) {
    throwSupabaseError(
      inserted.error, "createReimbursement",
      "Não foi possível registrar o reembolso.",
    );
  }
  invalidate(workspaceId, personId);
  return String(inserted.data.id);
}

export async function allocateReimbursement(data: FormData) {
  const workspaceId = uuid.parse(data.get("workspace_id"));
  const reimbursementId = uuid.parse(data.get("reimbursement_id"));
  const allocations = z.array(z.object({
    expenseAllocationId: uuid,
    amount: z.number().finite().positive(),
  })).min(1).parse(JSON.parse(String(data.get("allocations") ?? "[]")));
  const { supabase } = await requireWorkspace(workspaceId);
  const rows = allocations.map((allocation, index) => ({
    workspace_id: workspaceId,
    reimbursement_id: reimbursementId,
    expense_allocation_id: allocation.expenseAllocationId,
    allocated_amount: allocation.amount,
    allocation_order: index + 1,
    manually_confirmed: checked(data, "manually_confirmed"),
  }));
  const result = await supabase.from("reimbursement_allocations").upsert(
    rows, { onConflict: "reimbursement_id,expense_allocation_id" },
  );
  if (result.error) {
    throwSupabaseError(
      result.error, "allocateReimbursement",
      "Não foi possível distribuir o reembolso.",
    );
  }
  invalidate(workspaceId);
}

export const reallocateReimbursement = allocateReimbursement;

export async function unlinkReimbursement(data: FormData) {
  const workspaceId = uuid.parse(data.get("workspace_id"));
  const reimbursementId = uuid.parse(data.get("reimbursement_id"));
  const expenseAllocationId = optionalUuid.parse(
    String(data.get("expense_allocation_id") ?? ""),
  );
  const { supabase } = await requireWorkspace(workspaceId);
  let query = supabase.from("reimbursement_allocations").delete()
    .eq("workspace_id", workspaceId).eq("reimbursement_id", reimbursementId);
  if (expenseAllocationId) query = query.eq(
    "expense_allocation_id", expenseAllocationId,
  );
  const result = await query;
  if (result.error) throw new Error("Não foi possível remover a alocação.");
  invalidate(workspaceId);
}

export async function classifyPixAsReimbursement(data: FormData) {
  const workspaceId = uuid.parse(data.get("workspace_id"));
  const transactionId = uuid.parse(data.get("transaction_id"));
  const personId = uuid.parse(data.get("person_id"));
  const { supabase } = await requireWorkspace(workspaceId);
  const transaction = await supabase.from("financial_transactions").select(
    "id,amount,competence_date,bank_direction",
  ).eq("id", transactionId).maybeSingle();
  if (transaction.error || !transaction.data) throw new Error("Pix não encontrado.");
  if (transaction.data.bank_direction !== "inflow") {
    throw new Error("Somente uma entrada pode ser classificada como reembolso.");
  }
  const create = new FormData();
  create.set("workspace_id", workspaceId);
  create.set("person_id", personId);
  create.set("incoming_transaction_id", transactionId);
  create.set("amount", String(transaction.data.amount));
  create.set("received_date", transaction.data.competence_date);
  create.set("source", "movement_action");
  create.set("manually_confirmed", "true");
  const reimbursementId = await createReimbursement(create);
  const reimbursementCategory = await supabase.from("financial_categories")
    .select("id").eq("slug", "reembolso").limit(1).maybeSingle();
  const update = await supabase.from("financial_transactions").update({
    person_flow_role: "reimbursement_received",
    reimbursement_role: "reimbursement",
    income_effect: "neutral",
    financial_role: "reimbursement",
    transaction_role: "refund",
    category_id: reimbursementCategory.data?.id ?? null,
  }).eq("id", transactionId);
  if (update.error) {
    throw new Error("Reembolso criado, mas a classificação não foi atualizada.");
  }
  const selectedExpenseId = optionalUuid.parse(
    String(data.get("expense_allocation_id") ?? ""),
  );
  const selectedAmount = nullable(data.get("allocated_amount"));
  const rawAllocations = selectedExpenseId && selectedAmount
    ? JSON.stringify([{
        expenseAllocationId: selectedExpenseId,
        amount: positiveMoney.parse(selectedAmount),
      }])
    : String(data.get("allocations") ?? "[]");
  if (rawAllocations !== "[]") {
    const allocation = new FormData();
    allocation.set("workspace_id", workspaceId);
    allocation.set("reimbursement_id", reimbursementId);
    allocation.set("allocations", rawAllocations);
    allocation.set("manually_confirmed", "true");
    await allocateReimbursement(allocation);
  }
  invalidate(workspaceId, personId);
  return reimbursementId;
}

export async function suggestReimbursementMatches(data: FormData) {
  const workspaceId = uuid.parse(data.get("workspace_id"));
  const transactionId = uuid.parse(data.get("transaction_id"));
  const personId = uuid.parse(data.get("person_id"));
  const { supabase } = await requireWorkspace(workspaceId);
  const [transaction, expenses] = await Promise.all([
    supabase.from("financial_transactions").select(
      "amount,competence_date,description,bank_direction",
    ).eq("id", transactionId).single(),
    supabase.from("expense_allocations").select(
      "id,person_id,pending_reimbursement_amount,source_commitment_occurrence_id",
    ).eq("workspace_id", workspaceId).eq("person_id", personId)
      .gt("pending_reimbursement_amount", 0)
      .in("status", ["pending", "partially_reimbursed"]),
  ]);
  if (transaction.error || transaction.data.bank_direction !== "inflow") {
    throw new Error("A sugestão exige um Pix recebido.");
  }
  if (expenses.error) throw new Error("Não foi possível buscar despesas pendentes.");
  const suggestions = buildReimbursementSuggestions({
    personId,
    amountCents: moneyToCents(transaction.data.amount),
    receivedDate: transaction.data.competence_date,
    description: transaction.data.description,
    expenses: expenses.data.map(expense => ({
      id: expense.id,
      personId: expense.person_id,
      pendingAmountCents: moneyToCents(expense.pending_reimbursement_amount),
    })),
  });
  for (const suggestion of suggestions) {
    await supabase.from("person_transaction_match_suggestions").upsert({
      workspace_id: workspaceId,
      transaction_id: transactionId,
      person_id: personId,
      suggestion_type: "reimbursement_link",
      confidence: suggestion.confidence,
      suggested_role: "reimbursement_received",
      suggested_expense_allocation_id: suggestion.expenseAllocationId,
      status: "pending",
      reason_metadata: { reasons: suggestion.reasons },
    });
  }
  invalidate(workspaceId, personId);
  return suggestions;
}

export async function confirmReimbursementMatch(data: FormData) {
  const workspaceId = uuid.parse(data.get("workspace_id"));
  const suggestionId = uuid.parse(data.get("suggestion_id"));
  const { supabase, user } = await requireWorkspace(workspaceId);
  const suggestion = await supabase.from("person_transaction_match_suggestions")
    .select("transaction_id,person_id,suggested_expense_allocation_id")
    .eq("workspace_id", workspaceId).eq("id", suggestionId).single();
  if (suggestion.error) throw new Error("Sugestão não encontrada.");
  const expense = await supabase.from("expense_allocations")
    .select("pending_reimbursement_amount")
    .eq("id", suggestion.data.suggested_expense_allocation_id).single();
  const transaction = await supabase.from("financial_transactions")
    .select("amount").eq("id", suggestion.data.transaction_id).single();
  if (expense.error || transaction.error) throw new Error("Vínculo incompleto.");
  const amountToAllocate = Math.min(
    Number(expense.data.pending_reimbursement_amount),
    Number(transaction.data.amount),
  );
  const classification = new FormData();
  classification.set("workspace_id", workspaceId);
  classification.set("transaction_id", suggestion.data.transaction_id);
  classification.set("person_id", suggestion.data.person_id);
  classification.set("allocations", JSON.stringify([{
    expenseAllocationId: suggestion.data.suggested_expense_allocation_id,
    amount: amountToAllocate,
  }]));
  await classifyPixAsReimbursement(classification);
  await supabase.from("person_transaction_match_suggestions").update({
    status: "accepted", reviewed_at: new Date().toISOString(),
    reviewed_by: user.id,
  }).eq("id", suggestionId);
  invalidate(workspaceId, suggestion.data.person_id);
}

export async function rejectReimbursementMatch(data: FormData) {
  const workspaceId = uuid.parse(data.get("workspace_id"));
  const suggestionId = uuid.parse(data.get("suggestion_id"));
  const { supabase, user } = await requireWorkspace(workspaceId);
  const result = await supabase.from("person_transaction_match_suggestions")
    .update({
      status: "rejected", reviewed_at: new Date().toISOString(),
      reviewed_by: user.id,
    }).eq("workspace_id", workspaceId).eq("id", suggestionId);
  if (result.error) throw new Error("Não foi possível rejeitar a sugestão.");
  invalidate(workspaceId);
}

export async function createSharedCommitmentAllocation(data: FormData) {
  const workspaceId = uuid.parse(data.get("workspace_id"));
  const commitmentId = uuid.parse(data.get("commitment_id"));
  const beneficiaryPersonId = uuid.parse(data.get("beneficiary_person_id"));
  const reimbursementPersonId = uuid.parse(data.get("reimbursement_person_id"));
  const { supabase } = await requireWorkspace(workspaceId);
  await Promise.all([
    requirePerson(supabase, workspaceId, beneficiaryPersonId),
    requirePerson(supabase, workspaceId, reimbursementPersonId),
  ]);
  const result = await supabase.from("financial_commitments").update({
    shared_expense_enabled: true,
    beneficiary_person_id: beneficiaryPersonId,
    user_responsibility_type: allocationType.exclude(["remainder"])
      .parse(data.get("user_responsibility_type")),
    user_responsibility_value: positiveMoney.parse(
      data.get("user_responsibility_value"),
    ),
    reimbursement_person_id: reimbursementPersonId,
    reimbursement_allocation_type: allocationType.parse(
      data.get("reimbursement_allocation_type"),
    ),
    reimbursement_allocation_value: Number(
      String(data.get("reimbursement_allocation_value") ?? "0")
        .replace(",", "."),
    ),
  }).eq("workspace_id", workspaceId).eq("id", commitmentId);
  if (result.error) throw new Error("Não foi possível salvar a responsabilidade.");
  invalidate(workspaceId, reimbursementPersonId);
}

export async function getPersonPixSummary(data: FormData) {
  const workspaceId = uuid.parse(data.get("workspace_id"));
  const personId = uuid.parse(data.get("person_id"));
  const from = date.parse(data.get("from"));
  const to = date.parse(data.get("to"));
  const { supabase } = await requireWorkspace(workspaceId);
  await requirePerson(supabase, workspaceId, personId);
  return queryPersonPixSummary(supabase, { workspaceId, personId, from, to });
}

export const calculatePersonNetCost = getPersonPixSummary;
