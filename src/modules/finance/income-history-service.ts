import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  extractCounterpartyFingerprint,
  fingerprintsMatch,
  type CounterpartyFingerprint,
} from "./financial-counterparty";
import {
  aggregateIncomeCreditsByMonth,
  calculateHistoricalMonthlyIncomeMedian,
  resolveExpectedBusinessDate,
  resolveMonthlyIncomeOccurrenceStatus,
  type ExpectedDateRule,
  type IncomeHistoricalStatistics,
} from "./income-expenses";

type TransactionRow = {
  id: string;
  owner_id: string;
  workspace_id: string | null;
  account_id: string;
  description: string;
  merchant: string | null;
  amount: number | string;
  competence_date: string;
  bank_direction: string | null;
  transaction_type: string;
  status: string;
  provider_metadata: unknown;
  source: string;
  financial_accounts?: { name: string; institution_name: string | null } | null;
};

export type HistoricalIncomePreview = {
  reference: {
    id: string;
    description: string;
    amountCents: number;
    date: string;
    accountName: string;
  };
  fingerprint: CounterpartyFingerprint;
  matchingTransactions: TransactionRow[];
  statistics: IncomeHistoricalStatistics;
  currentMonthReceivedCents: number;
  currentMonthCredits: number;
};

const transactionSelect = [
  "id",
  "owner_id",
  "workspace_id",
  "account_id",
  "description",
  "merchant",
  "amount",
  "competence_date",
  "bank_direction",
  "transaction_type",
  "status",
  "provider_metadata",
  "source",
  "financial_accounts:financial_accounts!financial_transactions_account_id_fkey(name,institution_name)",
].join(",");

const moneyToCents = (value: number | string) =>
  Math.round(Math.abs(Number(value)) * 100);

const addMonths = (month: string, amount: number) => {
  const date = new Date(`${month.slice(0, 7)}-01T12:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + amount);
  return date.toISOString().slice(0, 7) + "-01";
};

const endOfMonth = (month: string) => {
  const date = new Date(`${month.slice(0, 7)}-01T12:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + 1);
  date.setUTCDate(0);
  return date.toISOString().slice(0, 10);
};

function transactionFingerprint(row: TransactionRow) {
  return extractCounterpartyFingerprint({
    description: row.description,
    merchant: row.merchant,
    providerMetadata: row.provider_metadata,
    provider: row.source,
    direction: "inflow",
  });
}

function isIncome(row: TransactionRow) {
  return row.bank_direction === "inflow" ||
    row.transaction_type === "income" ||
    row.transaction_type === "refund";
}

export function serializableIncomeFingerprint(
  fingerprint: CounterpartyFingerprint,
) {
  return {
    providerCounterpartyId: fingerprint.providerCounterpartyId,
    pixKeyHash: fingerprint.pixKeyHash,
    taxNumberHash: fingerprint.taxNumberHash,
    maskedTaxNumber: fingerprint.maskedTaxNumber,
    maskedPixKey: fingerprint.maskedPixKey,
    bankCode: fingerprint.bankCode,
    bankName: fingerprint.bankName,
    branchMasked: fingerprint.branchMasked,
    accountMasked: fingerprint.accountMasked,
    merchantIdentifier: fingerprint.merchantIdentifier,
    normalizedCounterpartyName: fingerprint.normalizedCounterpartyName,
    descriptionQualifier: fingerprint.descriptionQualifier,
    descriptionFingerprint: fingerprint.descriptionFingerprint,
    compositeFingerprint: fingerprint.compositeFingerprint,
    confidence: fingerprint.confidence,
    primaryIdentifier: fingerprint.primaryIdentifier,
  };
}

export function parseStoredIncomeFingerprint(
  value: unknown,
): CounterpartyFingerprint | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const compositeFingerprint = String(row.compositeFingerprint ?? "");
  const primaryIdentifier = String(row.primaryIdentifier ?? "");
  if (!compositeFingerprint || ![
    "provider_counterparty_id",
    "tax_number_hash",
    "pix_key_hash",
    "bank_account",
    "merchant_identifier",
    "normalized_name",
    "description",
  ].includes(primaryIdentifier)) return null;
  const nullable = (field: string) =>
    typeof row[field] === "string" && row[field] ? String(row[field]) : null;
  return {
    providerCounterpartyId: nullable("providerCounterpartyId"),
    pixKeyHash: nullable("pixKeyHash"),
    taxNumberHash: nullable("taxNumberHash"),
    maskedTaxNumber: nullable("maskedTaxNumber"),
    maskedPixKey: nullable("maskedPixKey"),
    bankCode: nullable("bankCode"),
    bankName: nullable("bankName"),
    branchMasked: nullable("branchMasked"),
    accountMasked: nullable("accountMasked"),
    merchantIdentifier: nullable("merchantIdentifier"),
    normalizedCounterpartyName: nullable("normalizedCounterpartyName"),
    descriptionQualifier: String(row.descriptionQualifier ?? ""),
    descriptionFingerprint: String(row.descriptionFingerprint ?? ""),
    compositeFingerprint,
    confidence: Number(row.confidence ?? 0),
    evidence: [],
    sourceFields: [],
    primaryIdentifier:
      primaryIdentifier as CounterpartyFingerprint["primaryIdentifier"],
  };
}

export async function getHistoricalIncomePreview(
  supabase: SupabaseClient,
  input: {
    workspaceId: string;
    userId: string;
    referenceTransactionId: string;
    endMonth: string;
    maximumMonths?: number;
  },
): Promise<HistoricalIncomePreview> {
  const referenceResult = await supabase.from("financial_transactions")
    .select(transactionSelect)
    .eq("id", input.referenceTransactionId)
    .eq("owner_id", input.userId)
    .single();
  if (referenceResult.error || !referenceResult.data) {
    throw new Error("A entrada selecionada não foi encontrada.");
  }
  const reference = referenceResult.data as unknown as TransactionRow;
  if (!isIncome(reference)) {
    throw new Error("Selecione uma movimentação que tenha entrado na conta.");
  }
  const fingerprint = transactionFingerprint(reference);
  if (fingerprint.confidence < 0.7 || !fingerprint.compositeFingerprint) {
    throw new Error(
      "Não foi possível identificar com segurança a origem desta entrada.",
    );
  }
  const from = addMonths(input.endMonth, -(input.maximumMonths ?? 12));
  const candidatesResult = await supabase.from("financial_transactions")
    .select(transactionSelect)
    .eq("owner_id", input.userId)
    .gte("competence_date", from)
    .lt("competence_date", addMonths(input.endMonth, 1))
    .in("status", ["realized", "pending", "partial"])
    .order("competence_date");
  if (candidatesResult.error) {
    throw new Error("Não foi possível carregar o histórico bancário.");
  }
  const matchingTransactions = (candidatesResult.data ?? [])
    .map(row => row as unknown as TransactionRow)
    .filter(isIncome)
    .filter(row => {
      const sameWorkspace = row.workspace_id === input.workspaceId ||
        (row.workspace_id === null && row.owner_id === input.userId);
      return sameWorkspace &&
        fingerprintsMatch(fingerprint, transactionFingerprint(row));
    });
  const monthly = aggregateIncomeCreditsByMonth(
    matchingTransactions.map(row => ({
      date: row.competence_date,
      amountCents: moneyToCents(row.amount),
    })),
  );
  const statistics = calculateHistoricalMonthlyIncomeMedian({
    monthlyTotals: monthly,
    maximumMonths: input.maximumMonths ?? 12,
    endMonth: input.endMonth,
    includeZeroMonths: false,
  });
  const currentMonth = input.endMonth.slice(0, 7);
  const currentRows = matchingTransactions.filter(
    row => row.competence_date.slice(0, 7) === currentMonth,
  );
  return {
    reference: {
      id: reference.id,
      description: reference.description,
      amountCents: moneyToCents(reference.amount),
      date: reference.competence_date,
      accountName: [
        reference.financial_accounts?.institution_name,
        reference.financial_accounts?.name,
      ].filter(Boolean).join(" · ") || "Conta bancária",
    },
    fingerprint,
    matchingTransactions,
    statistics,
    currentMonthReceivedCents: currentRows.reduce(
      (sum, row) => sum + moneyToCents(row.amount),
      0,
    ),
    currentMonthCredits: currentRows.length,
  };
}

export async function recalculateOccurrenceTotals(
  supabase: SupabaseClient,
  input: {
    workspaceId: string;
    occurrenceId: string;
    direction: "income" | "expense";
    expectedAmountCents: number | null;
    competenceMonth: string;
    today: string;
    forceClosed?: boolean;
  },
) {
  const links = await supabase.from("financial_occurrence_transactions")
    .select("allocated_amount,transaction_id")
    .eq("workspace_id", input.workspaceId)
    .eq("occurrence_id", input.occurrenceId);
  if (links.error) throw new Error("Não foi possível consolidar os valores.");
  const totalCents = (links.data ?? []).reduce(
    (sum, row) => sum + moneyToCents(row.allocated_amount),
    0,
  );
  const monthComplete = input.forceClosed === true ||
    endOfMonth(input.competenceMonth) < input.today;
  const status = input.direction === "income"
    ? resolveMonthlyIncomeOccurrenceStatus({
        expectedAmountCents: input.expectedAmountCents,
        receivedAmountCents: totalCents,
        monthComplete,
        expectedDatePassed: monthComplete,
      })
    : totalCents > 0
      ? "paid"
      : monthComplete
        ? "overdue"
        : "pending";
  const updated = await supabase.from("financial_commitment_occurrences")
    .update({
      actual_amount: totalCents / 100,
      received_amount: input.direction === "income" ? totalCents / 100 : 0,
      paid_amount: input.direction === "expense" ? totalCents / 100 : 0,
      linked_transactions_count: links.data?.length ?? 0,
      status,
      payment_date: totalCents > 0 ? input.today : null,
      realized_at: totalCents > 0 ? new Date().toISOString() : null,
    })
    .eq("workspace_id", input.workspaceId)
    .eq("id", input.occurrenceId);
  if (updated.error) throw new Error("Não foi possível atualizar o total mensal.");
}

export async function linkIncomeTransactions(
  supabase: SupabaseClient,
  input: {
    workspaceId: string;
    userId: string;
    commitmentId: string;
    expectedAmountCents: number | null;
    expectedAmountSource:
      | "historical_median"
      | "fixed_definition"
      | "manual_override"
      | "system_fallback";
    expectedDateRule: ExpectedDateRule;
    expectedDateDay?: number | null;
    transactions: TransactionRow[];
    linkSource: "manual" | "historical_backfill" | "automatic_sync";
  },
) {
  const grouped = new Map<string, TransactionRow[]>();
  for (const transaction of input.transactions) {
    const month = `${transaction.competence_date.slice(0, 7)}-01`;
    grouped.set(month, [...(grouped.get(month) ?? []), transaction]);
  }
  const affected: string[] = [];
  for (const [month, transactions] of grouped) {
    const dueDate = resolveExpectedBusinessDate({
      month,
      rule: input.expectedDateRule,
      fixedDay: input.expectedDateDay,
    });
    const occurrenceResult = await supabase
      .from("financial_commitment_occurrences")
      .upsert({
        workspace_id: input.workspaceId,
        created_by: input.userId,
        commitment_id: input.commitmentId,
        competence_month: month,
        sequence_number: 1,
        expected_due_date: dueDate,
        expected_amount: (input.expectedAmountCents ?? 0) / 100,
        expected_amount_source: input.expectedAmountSource,
        status: "expected",
      }, { onConflict: "commitment_id,competence_month,sequence_number" })
      .select("id,expected_amount")
      .single();
    if (occurrenceResult.error || !occurrenceResult.data) {
      throw new Error("Não foi possível criar a competência mensal.");
    }
    const occurrenceId = String(occurrenceResult.data.id);
    const rows = transactions.map(transaction => ({
      workspace_id: input.workspaceId,
      occurrence_id: occurrenceId,
      transaction_id: transaction.id,
      allocated_amount: Math.abs(Number(transaction.amount)),
      link_source: input.linkSource,
      confidence: input.linkSource === "manual" ? 1 : 0.95,
      manually_confirmed: input.linkSource !== "automatic_sync",
      created_by: input.userId,
    }));
    const links = await supabase.from("financial_occurrence_transactions")
      .upsert(rows, { onConflict: "transaction_id", ignoreDuplicates: true });
    if (links.error) throw new Error("Não foi possível vincular o histórico.");
    await recalculateOccurrenceTotals(supabase, {
      workspaceId: input.workspaceId,
      occurrenceId,
      direction: "income",
      expectedAmountCents: moneyToCents(occurrenceResult.data.expected_amount),
      competenceMonth: month,
      today: new Date().toISOString().slice(0, 10),
    });
    affected.push(occurrenceId);
  }
  return affected;
}

export async function recalculateIncomeDefinitionStatistics(
  supabase: SupabaseClient,
  input: {
    workspaceId: string;
    commitmentId: string;
    endMonth: string;
  },
) {
  const occurrences = await supabase.from("financial_commitment_occurrences")
    .select("competence_month,received_amount,linked_transactions_count")
    .eq("workspace_id", input.workspaceId)
    .eq("commitment_id", input.commitmentId)
    .lt("competence_month", `${input.endMonth.slice(0, 7)}-01`)
    .order("competence_month");
  if (occurrences.error) throw new Error("Não foi possível recalcular a mediana.");
  const statistics = calculateHistoricalMonthlyIncomeMedian({
    monthlyTotals: (occurrences.data ?? []).map(row => ({
      month: String(row.competence_month),
      totalCents: moneyToCents(row.received_amount),
      creditsCount: Number(row.linked_transactions_count ?? 0),
      hasCoverage: Number(row.linked_transactions_count ?? 0) > 0,
      isComplete: true,
    })),
    endMonth: input.endMonth,
    includeZeroMonths: false,
  });
  const update = await supabase.from("financial_commitments").update({
    historical_median_amount: statistics.medianAmount === null
      ? null
      : statistics.medianAmount / 100,
    historical_average_amount: statistics.averageAmount === null
      ? null
      : statistics.averageAmount / 100,
    historical_months_count: statistics.monthsAvailable,
    expected_amount: statistics.medianAmount === null
      ? undefined
      : statistics.medianAmount / 100,
  }).eq("workspace_id", input.workspaceId).eq("id", input.commitmentId);
  if (update.error) throw new Error("Não foi possível salvar a nova mediana.");
  return statistics;
}

export async function reconcileHistoricalIncomeTransactions(
  supabase: SupabaseClient,
  input: { userId: string; workspaceId?: string | null },
) {
  let definitionsQuery = supabase.from("financial_commitments").select(
    "id,workspace_id,expected_amount,historical_median_amount,expected_date_rule,expected_date_day,source_fingerprint_data",
  ).eq("created_by", input.userId)
    .eq("cash_flow_direction", "income")
    .eq("estimation_method", "historical_median")
    .eq("aggregation_mode", "monthly_total")
    .eq("status", "active")
    .eq("auto_match_enabled", true)
    .not("source_fingerprint", "is", null);
  if (input.workspaceId) {
    definitionsQuery = definitionsQuery.eq("workspace_id", input.workspaceId);
  }
  const definitions = await definitionsQuery;
  if (definitions.error || !definitions.data?.length) return { linked: 0 };
  const from = new Date();
  from.setUTCDate(from.getUTCDate() - 62);
  const transactions = await supabase.from("financial_transactions")
    .select(transactionSelect)
    .eq("owner_id", input.userId)
    .gte("competence_date", from.toISOString().slice(0, 10))
    .in("status", ["realized", "pending", "partial"])
    .or("bank_direction.eq.inflow,transaction_type.eq.income");
  if (transactions.error) {
    throw new Error("Não foi possível reconhecer as novas receitas.");
  }
  let linked = 0;
  for (const definition of definitions.data) {
    const stored = parseStoredIncomeFingerprint(
      definition.source_fingerprint_data,
    );
    if (!stored) continue;
    const matching = (transactions.data ?? [])
      .map(row => row as unknown as TransactionRow)
      .filter(isIncome)
      .filter(row =>
        (
          row.workspace_id === definition.workspace_id ||
          (row.workspace_id === null && row.owner_id === input.userId)
        ) &&
        fingerprintsMatch(stored, transactionFingerprint(row))
      );
    if (!matching.length) continue;
    await linkIncomeTransactions(supabase, {
      workspaceId: String(definition.workspace_id),
      userId: input.userId,
      commitmentId: String(definition.id),
      expectedAmountCents: moneyToCents(
        definition.historical_median_amount ?? definition.expected_amount,
      ),
      expectedAmountSource: definition.historical_median_amount == null
        ? "system_fallback"
        : "historical_median",
      expectedDateRule: String(
        definition.expected_date_rule ?? "unspecified_in_month",
      ) as ExpectedDateRule,
      expectedDateDay: definition.expected_date_day == null
        ? null
        : Number(definition.expected_date_day),
      transactions: matching,
      linkSource: "automatic_sync",
    });
    linked += matching.length;
  }
  return { linked };
}
