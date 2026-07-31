"use server";

import { z } from "zod";
import {
  failedFormResult,
  successfulFormResult,
  type FinanceFormResult,
} from "./commitment-form-result";
import {
  formatBrazilianMoney,
  parseBrazilianMoneyToCents,
  relationTargetParts,
} from "./simple-commitments";
import {
  getHistoricalIncomePreview,
  linkIncomeTransactions,
  recalculateOccurrenceTotals,
  recalculateIncomeDefinitionStatistics,
  serializableIncomeFingerprint,
} from "./income-history-service";
import {
  resolveExpectedBusinessDate,
  type ExpectedDateRule,
} from "./income-expenses";
import { getActiveFinanceWorkspaceContext } from "./workspace-context";
import { invalidateCommitmentsCache } from "./commitments-cache";
import { resolveCommitmentFinancialEffects } from "./financial-impact";

const uuid = z.string().uuid();
const directionSchema = z.enum(["income", "expense"]);
const recurrenceSchema = z.enum(["none", "monthly", "weekly", "biweekly", "annual", "custom"]);
const expectedDateRuleSchema = z.enum([
  "fixed_day",
  "first_business_day",
  "fifth_business_day",
  "last_business_day",
  "unspecified_in_month",
]);

const currentMonth = () => `${new Date().toISOString().slice(0, 7)}-01`;
const addMonths = (month: string, amount: number) => {
  const date = new Date(`${month.slice(0, 7)}-01T12:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + amount);
  return `${date.toISOString().slice(0, 7)}-01`;
};

const actionError = (error: unknown, fallback: string) => {
  const message = error instanceof Error ? error.message : "";
  return failedFormResult(
    message && !/supabase|postgres|rls|row-level|constraint/i.test(message)
      ? message
      : fallback,
  );
};

async function createIncomeOccurrence(input: {
  supabase: Awaited<ReturnType<typeof getActiveFinanceWorkspaceContext>>["supabase"];
  workspaceId: string;
  userId: string;
  commitmentId: string;
  month: string;
  expectedAmountCents: number;
  expectedAmountSource: "historical_median" | "fixed_definition";
  expectedDateRule: ExpectedDateRule;
  expectedDateDay: number | null;
}) {
  const result = await input.supabase
    .from("financial_commitment_occurrences")
    .upsert({
      workspace_id: input.workspaceId,
      created_by: input.userId,
      commitment_id: input.commitmentId,
      competence_month: input.month,
      sequence_number: 1,
      expected_due_date: resolveExpectedBusinessDate({
        month: input.month,
        rule: input.expectedDateRule,
        fixedDay: input.expectedDateDay,
      }),
      expected_amount: input.expectedAmountCents / 100,
      expected_amount_source: input.expectedAmountSource,
      received_amount: 0,
      linked_transactions_count: 0,
      status: "expected",
    }, { onConflict: "commitment_id,competence_month,sequence_number" })
    .select("id")
    .single();
  if (result.error || !result.data) {
    throw new Error("Não foi possível criar a previsão mensal.");
  }
  return String(result.data.id);
}

export type IncomeHistoryPreviewActionResult =
  | {
      ok: true;
      preview: {
        referenceId: string;
        period: string;
        medianAmountCents: number | null;
        averageAmountCents: number | null;
        lastMonthAmountCents: number;
        currentMonthAmountCents: number;
        creditsCount: number;
        monthsCount: number;
        confidence: "low" | "medium" | "high";
        warning: string | null;
      };
    }
  | { ok: false; message: string };

export async function previewHistoricalIncome(
  data: FormData,
): Promise<IncomeHistoryPreviewActionResult> {
  try {
    const requestedWorkspaceId = uuid.parse(data.get("workspace_id"));
    const referenceTransactionId = uuid.parse(
      data.get("reference_transaction_id"),
    );
    const context = await getActiveFinanceWorkspaceContext(
      requestedWorkspaceId,
    );
    const preview = await getHistoricalIncomePreview(context.supabase, {
      workspaceId: context.workspaceId,
      userId: context.userId,
      referenceTransactionId,
      endMonth: currentMonth(),
    });
    const totals = preview.statistics.monthlyTotals;
    return {
      ok: true,
      preview: {
        referenceId: preview.reference.id,
        period: preview.statistics.firstMonth && preview.statistics.lastMonth
          ? `${preview.statistics.firstMonth.slice(0, 7)} a ${preview.statistics.lastMonth.slice(0, 7)}`
          : "Histórico recente",
        medianAmountCents: preview.statistics.medianAmount,
        averageAmountCents: preview.statistics.averageAmount,
        lastMonthAmountCents: totals.at(-1)?.totalCents ?? 0,
        currentMonthAmountCents: preview.currentMonthReceivedCents,
        creditsCount: preview.statistics.totalCredits +
          preview.currentMonthCredits,
        monthsCount: preview.statistics.monthsAvailable,
        confidence: preview.statistics.confidence,
        warning: preview.statistics.warning,
      },
    };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error
        ? error.message
        : "Não foi possível analisar esta entrada.",
    };
  }
}

export async function createSimpleIncome(
  data: FormData,
): Promise<FinanceFormResult> {
  try {
    const requestedWorkspaceId = uuid.parse(data.get("workspace_id"));
    const title = z.string().trim().min(1).max(160).parse(data.get("title"));
    const amountCents = parseBrazilianMoneyToCents(
      String(data.get("amount") ?? ""),
    );
    if (amountCents === null) {
      return failedFormResult("Informe um valor esperado válido.", {
        amount: ["Informe um valor esperado válido."],
      });
    }
    const recurrence = recurrenceSchema.parse(data.get("recurrence"));
    const relation = relationTargetParts(
      String(data.get("relation_target") ?? "personal"),
    );
    const context = await getActiveFinanceWorkspaceContext(
      requestedWorkspaceId,
    );
    if (relation.personId) {
      const person = await context.supabase.from("financial_people")
        .select("id")
        .eq("workspace_id", context.workspaceId)
        .eq("id", relation.personId)
        .eq("is_active", true)
        .maybeSingle();
      if (person.error || !person.data) {
        return failedFormResult("Selecione uma pessoa válida.");
      }
    }
    const expectedDateRule = expectedDateRuleSchema.parse(
      data.get("expected_date_rule") || "unspecified_in_month",
    );
    const expectedDateDay = expectedDateRule === "fixed_day"
      ? z.coerce.number().int().min(1).max(31).parse(
          data.get("expected_date_day") || 1,
        )
      : null;
    const month = currentMonth();
    const inserted = await context.supabase.from("financial_commitments")
      .insert({
        workspace_id: context.workspaceId,
        created_by: context.userId,
        visibility: "private",
        title,
        commitment_type: recurrence === "none" ? "one_time" : "recurring",
        recurrence_frequency: recurrence === "none" ? null : recurrence,
        recurrence_interval: 1,
        amount_type: "fixed",
        expected_amount: amountCents / 100,
        currency_code: "BRL",
        start_date: month,
        due_day: expectedDateDay,
        status: "active",
        auto_match_enabled: false,
        source: "manual",
        generates_future_projections: recurrence !== "none",
        cash_flow_direction: "income",
        income_basis: "net",
        cash_flow_effect: "inflow",
        planning_effect: "increase",
        analytics_effect: "income",
        payment_channel: "bank",
        include_in_monthly_budget: true,
        context_type: relation.contextType,
        estimation_method: "fixed",
        aggregation_mode: "monthly_total",
        expected_date_rule: expectedDateRule,
        expected_date_day: expectedDateDay,
        planning_enabled: true,
        notes: String(data.get("notes") ?? "").trim() || null,
      })
      .select("id")
      .single();
    if (inserted.error || !inserted.data) {
      throw new Error("Não foi possível adicionar a receita.");
    }
    const commitmentId = String(inserted.data.id);
    if (relation.personId) {
      const allocation = await context.supabase.from("commitment_people")
        .insert({
          workspace_id: context.workspaceId,
          created_by: context.userId,
          commitment_id: commitmentId,
          person_id: relation.personId,
          allocation_type: "full",
          allocation_value: 100,
          is_primary: true,
        });
      if (allocation.error) throw new Error("Não foi possível vincular a pessoa.");
    }
    await createIncomeOccurrence({
      ...context,
      commitmentId,
      month,
      expectedAmountCents: amountCents,
      expectedAmountSource: "fixed_definition",
      expectedDateRule,
      expectedDateDay,
    });
    if (recurrence !== "none") {
      await createIncomeOccurrence({
        ...context,
        commitmentId,
        month: addMonths(month, 1),
        expectedAmountCents: amountCents,
        expectedAmountSource: "fixed_definition",
        expectedDateRule,
        expectedDateDay,
      });
    }
    await context.supabase.from("financial_commitment_history").insert({
      workspace_id: context.workspaceId,
      commitment_id: commitmentId,
      created_by: context.userId,
      event_type: "created",
      summary: "Receita criada.",
    });
    invalidateCommitmentsCache(context.workspaceId, {
      month: month.slice(0, 7),
      personId: relation.personId ?? undefined,
    });
    return successfulFormResult("Receita adicionada.", commitmentId);
  } catch (error) {
    return actionError(error, "Não foi possível adicionar a receita.");
  }
}

export async function createHistoricalIncome(
  data: FormData,
): Promise<FinanceFormResult> {
  try {
    const requestedWorkspaceId = uuid.parse(data.get("workspace_id"));
    const referenceTransactionId = uuid.parse(
      data.get("reference_transaction_id"),
    );
    const title = z.string().trim().min(1).max(160).parse(data.get("title"));
    const relation = relationTargetParts(
      String(data.get("relation_target") ?? "work"),
    );
    const expectedDateRule = expectedDateRuleSchema.parse(
      data.get("expected_date_rule") || "unspecified_in_month",
    );
    const expectedDateDay = expectedDateRule === "fixed_day"
      ? z.coerce.number().int().min(1).max(31).parse(
          data.get("expected_date_day") || 1,
        )
      : null;
    const context = await getActiveFinanceWorkspaceContext(
      requestedWorkspaceId,
    );
    if (relation.personId) {
      const person = await context.supabase.from("financial_people")
        .select("id")
        .eq("workspace_id", context.workspaceId)
        .eq("id", relation.personId)
        .eq("is_active", true)
        .maybeSingle();
      if (person.error || !person.data) {
        return failedFormResult("Selecione uma pessoa válida.");
      }
    }
    const month = currentMonth();
    const preview = await getHistoricalIncomePreview(context.supabase, {
      workspaceId: context.workspaceId,
      userId: context.userId,
      referenceTransactionId,
      endMonth: month,
    });
    const manualFallback = parseBrazilianMoneyToCents(
      String(data.get("manual_expected_amount") ?? ""),
    );
    const expectedAmountCents = preview.statistics.medianAmount ??
      manualFallback ??
      preview.reference.amountCents;
    const fingerprintData = serializableIncomeFingerprint(preview.fingerprint);
    const conflict = await context.supabase.from("financial_commitments")
      .select("id,title")
      .eq("workspace_id", context.workspaceId)
      .eq("cash_flow_direction", "income")
      .eq("source_fingerprint", preview.fingerprint.compositeFingerprint)
      .eq("status", "active")
      .maybeSingle();
    if (conflict.data) {
      return failedFormResult(
        `Esta fonte já está vinculada à receita “${conflict.data.title}”.`,
      );
    }
    if (conflict.error) {
      throw new Error("Não foi possível validar a fonte pagadora.");
    }
    const inserted = await context.supabase.from("financial_commitments")
      .insert({
        workspace_id: context.workspaceId,
        created_by: context.userId,
        visibility: "private",
        title,
        commitment_type: "recurring",
        recurrence_frequency: "monthly",
        recurrence_interval: 1,
        amount_type: "variable",
        expected_amount: expectedAmountCents / 100,
        currency_code: "BRL",
        start_date: preview.statistics.firstMonth ?? month,
        status: "active",
        auto_match_enabled: true,
        source: "movement",
        source_record_id: referenceTransactionId,
        generates_future_projections: true,
        cash_flow_direction: "income",
        income_basis: "net",
        cash_flow_effect: "inflow",
        planning_effect: "increase",
        analytics_effect: "income",
        payment_channel: "bank",
        include_in_monthly_budget: true,
        context_type: relation.contextType,
        estimation_method: "historical_median",
        aggregation_mode: "monthly_total",
        expected_date_rule: expectedDateRule,
        expected_date_day: expectedDateDay,
        historical_window_months: 12,
        historical_median_amount: preview.statistics.medianAmount === null
          ? null
          : preview.statistics.medianAmount / 100,
        historical_average_amount: preview.statistics.averageAmount === null
          ? null
          : preview.statistics.averageAmount / 100,
        historical_months_count: preview.statistics.monthsAvailable,
        source_fingerprint: preview.fingerprint.compositeFingerprint,
        source_fingerprint_data: fingerprintData,
        planning_enabled: true,
      })
      .select("id")
      .single();
    if (inserted.error || !inserted.data) {
      throw new Error("Não foi possível criar a receita pelo histórico.");
    }
    const commitmentId = String(inserted.data.id);
    if (relation.personId) {
      const allocation = await context.supabase.from("commitment_people")
        .insert({
          workspace_id: context.workspaceId,
          created_by: context.userId,
          commitment_id: commitmentId,
          person_id: relation.personId,
          allocation_type: "full",
          allocation_value: 100,
          is_primary: true,
        });
      if (allocation.error) {
        throw new Error("Não foi possível vincular a pessoa.");
      }
    }
    await linkIncomeTransactions(context.supabase, {
      workspaceId: context.workspaceId,
      userId: context.userId,
      commitmentId,
      expectedAmountCents,
      expectedAmountSource: preview.statistics.medianAmount === null
        ? "system_fallback"
        : "historical_median",
      expectedDateRule,
      expectedDateDay,
      transactions: preview.matchingTransactions,
      linkSource: "historical_backfill",
    });
    await createIncomeOccurrence({
      ...context,
      commitmentId,
      month: addMonths(month, 1),
      expectedAmountCents,
      expectedAmountSource: preview.statistics.medianAmount === null
        ? "fixed_definition"
        : "historical_median",
      expectedDateRule,
      expectedDateDay,
    });
    await context.supabase.from("financial_commitment_history").insert({
      workspace_id: context.workspaceId,
      commitment_id: commitmentId,
      created_by: context.userId,
      event_type: "created",
      summary: `Receita criada com ${preview.matchingTransactions.length} crédito(s) históricos.`,
    });
    invalidateCommitmentsCache(context.workspaceId, {
      month: month.slice(0, 7),
      personId: relation.personId ?? undefined,
    });
    return successfulFormResult(
      `Receita adicionada. ${preview.matchingTransactions.length} crédito(s) foram agrupados por mês.`,
      commitmentId,
    );
  } catch (error) {
    return actionError(
      error,
      "Não foi possível criar a receita pelo histórico.",
    );
  }
}

export async function setNextIncomeExpectedAmount(
  data: FormData,
): Promise<FinanceFormResult> {
  try {
    const workspaceId = uuid.parse(data.get("workspace_id"));
    const commitmentId = uuid.parse(data.get("commitment_id"));
    const month = z.string().regex(/^\d{4}-\d{2}$/).parse(data.get("month"));
    const amountCents = parseBrazilianMoneyToCents(
      String(data.get("amount") ?? ""),
    );
    if (amountCents === null) {
      return failedFormResult("Informe uma previsão válida.");
    }
    const context = await getActiveFinanceWorkspaceContext(workspaceId);
    const result = await context.supabase
      .from("financial_commitment_occurrences")
      .update({
        expected_amount: amountCents / 100,
        manual_override_amount: amountCents / 100,
        expected_amount_source: "manual_override",
        notes: String(data.get("notes") ?? "").trim() || null,
      })
      .eq("workspace_id", context.workspaceId)
      .eq("commitment_id", commitmentId)
      .eq("competence_month", `${month}-01`);
    if (result.error) throw new Error("Não foi possível salvar a previsão.");
    invalidateCommitmentsCache(context.workspaceId, { month });
    return successfulFormResult("Previsão específica salva.");
  } catch (error) {
    return actionError(error, "Não foi possível salvar a previsão.");
  }
}

export async function removeIncomeExpectedOverride(
  data: FormData,
): Promise<FinanceFormResult> {
  try {
    const workspaceId = uuid.parse(data.get("workspace_id"));
    const commitmentId = uuid.parse(data.get("commitment_id"));
    const month = z.string().regex(/^\d{4}-\d{2}$/).parse(data.get("month"));
    const context = await getActiveFinanceWorkspaceContext(workspaceId);
    const definition = await context.supabase.from("financial_commitments")
      .select("expected_amount,historical_median_amount,estimation_method")
      .eq("workspace_id", context.workspaceId)
      .eq("id", commitmentId)
      .single();
    if (definition.error || !definition.data) {
      return failedFormResult("Receita não encontrada.");
    }
    const historical = definition.data.estimation_method === "historical_median";
    const amount = historical
      ? definition.data.historical_median_amount
      : definition.data.expected_amount;
    const result = await context.supabase
      .from("financial_commitment_occurrences")
      .update({
        expected_amount: amount,
        manual_override_amount: null,
        expected_amount_source: historical
          ? "historical_median"
          : "fixed_definition",
      })
      .eq("workspace_id", context.workspaceId)
      .eq("commitment_id", commitmentId)
      .eq("competence_month", `${month}-01`);
    if (result.error) throw new Error("Não foi possível remover a previsão.");
    invalidateCommitmentsCache(context.workspaceId, { month });
    return successfulFormResult("A previsão voltou ao valor padrão.");
  } catch (error) {
    return actionError(error, "Não foi possível remover a previsão.");
  }
}

export async function recalculateIncomeMedian(
  data: FormData,
): Promise<FinanceFormResult> {
  try {
    const workspaceId = uuid.parse(data.get("workspace_id"));
    const commitmentId = uuid.parse(data.get("commitment_id"));
    const context = await getActiveFinanceWorkspaceContext(workspaceId);
    const statistics = await recalculateIncomeDefinitionStatistics(
      context.supabase,
      {
        workspaceId: context.workspaceId,
        commitmentId,
        endMonth: currentMonth(),
      },
    );
    invalidateCommitmentsCache(context.workspaceId);
    return successfulFormResult(
      statistics.medianAmount === null
        ? "Ainda não há meses completos suficientes para uma mediana."
        : `Mediana recalculada em ${formatBrazilianMoney(statistics.medianAmount)}.`,
    );
  } catch (error) {
    return actionError(error, "Não foi possível recalcular a mediana.");
  }
}

export async function linkTransactionToIncomeOccurrence(
  data: FormData,
): Promise<FinanceFormResult> {
  try {
    const workspaceId = uuid.parse(data.get("workspace_id"));
    const occurrenceId = uuid.parse(data.get("occurrence_id"));
    const transactionId = uuid.parse(data.get("transaction_id"));
    const direction = directionSchema.parse(data.get("direction") || "income");
    if (direction !== "income") {
      return failedFormResult("Este vínculo aceita somente entradas bancárias.");
    }
    const context = await getActiveFinanceWorkspaceContext(workspaceId);
    const [occurrence, transaction] = await Promise.all([
      context.supabase.from("financial_commitment_occurrences")
        .select("id,commitment_id,competence_month,expected_amount")
        .eq("workspace_id", context.workspaceId)
        .eq("id", occurrenceId)
        .single(),
      context.supabase.from("financial_transactions")
        .select("id,owner_id,workspace_id,amount,bank_direction,transaction_type")
        .eq("id", transactionId)
        .eq("owner_id", context.userId)
        .single(),
    ]);
    if (occurrence.error || !occurrence.data) {
      return failedFormResult("A competência mensal não foi encontrada.");
    }
    if (transaction.error || !transaction.data) {
      return failedFormResult("A entrada selecionada não foi encontrada.");
    }
    const row = transaction.data;
    const isIncome = row.bank_direction === "inflow" ||
      ["income", "refund"].includes(String(row.transaction_type));
    const sameWorkspace = row.workspace_id === context.workspaceId ||
      row.workspace_id === null;
    if (!isIncome || !sameWorkspace) {
      return failedFormResult(
        !isIncome
          ? "Selecione uma movimentação que tenha entrado na conta."
          : "A movimentação pertence a outro espaço financeiro.",
      );
    }
    const linked = await context.supabase
      .from("financial_occurrence_transactions")
      .insert({
        workspace_id: context.workspaceId,
        occurrence_id: occurrenceId,
        transaction_id: transactionId,
        allocated_amount: Math.abs(Number(row.amount)),
        link_source: "manual",
        confidence: 1,
        manually_confirmed: true,
        created_by: context.userId,
      });
    if (linked.error) {
      return failedFormResult(
        String(linked.error.code) === "23505"
          ? "Esta movimentação já confirma uma receita."
          : "Não foi possível vincular esta entrada.",
      );
    }
    await recalculateOccurrenceTotals(context.supabase, {
      workspaceId: context.workspaceId,
      occurrenceId,
      direction: "income",
      expectedAmountCents: Math.round(
        Number(occurrence.data.expected_amount ?? 0) * 100,
      ),
      competenceMonth: String(occurrence.data.competence_month),
      today: new Date().toISOString().slice(0, 10),
    });
    invalidateCommitmentsCache(context.workspaceId, {
      month: String(occurrence.data.competence_month).slice(0, 7),
    });
    return successfulFormResult("Entrada vinculada à receita.");
  } catch (error) {
    return actionError(error, "Não foi possível vincular esta entrada.");
  }
}

export async function unlinkTransactionFromIncomeOccurrence(
  data: FormData,
): Promise<FinanceFormResult> {
  try {
    const workspaceId = uuid.parse(data.get("workspace_id"));
    const occurrenceId = uuid.parse(data.get("occurrence_id"));
    const transactionId = uuid.parse(data.get("transaction_id"));
    const context = await getActiveFinanceWorkspaceContext(workspaceId);
    const occurrence = await context.supabase
      .from("financial_commitment_occurrences")
      .select("id,commitment_id,competence_month,expected_amount")
      .eq("workspace_id", context.workspaceId)
      .eq("id", occurrenceId)
      .single();
    if (occurrence.error || !occurrence.data) {
      return failedFormResult("A competência mensal não foi encontrada.");
    }
    const removed = await context.supabase
      .from("financial_occurrence_transactions")
      .delete()
      .eq("workspace_id", context.workspaceId)
      .eq("occurrence_id", occurrenceId)
      .eq("transaction_id", transactionId);
    if (removed.error) {
      throw new Error("Não foi possível remover o vínculo.");
    }
    await recalculateOccurrenceTotals(context.supabase, {
      workspaceId: context.workspaceId,
      occurrenceId,
      direction: "income",
      expectedAmountCents: Math.round(
        Number(occurrence.data.expected_amount ?? 0) * 100,
      ),
      competenceMonth: String(occurrence.data.competence_month),
      today: new Date().toISOString().slice(0, 10),
    });
    await recalculateIncomeDefinitionStatistics(context.supabase, {
      workspaceId: context.workspaceId,
      commitmentId: String(occurrence.data.commitment_id),
      endMonth: currentMonth(),
    });
    invalidateCommitmentsCache(context.workspaceId);
    return successfulFormResult("Entrada desvinculada e totais recalculados.");
  } catch (error) {
    return actionError(error, "Não foi possível remover o vínculo.");
  }
}

export async function closeIncomeMonth(
  data: FormData,
): Promise<FinanceFormResult> {
  try {
    const workspaceId = uuid.parse(data.get("workspace_id"));
    const occurrenceId = uuid.parse(data.get("occurrence_id"));
    const context = await getActiveFinanceWorkspaceContext(workspaceId);
    const occurrence = await context.supabase
      .from("financial_commitment_occurrences")
      .select("id,commitment_id,competence_month,expected_amount")
      .eq("workspace_id", context.workspaceId)
      .eq("id", occurrenceId)
      .single();
    if (occurrence.error || !occurrence.data) {
      return failedFormResult("A competência mensal não foi encontrada.");
    }
    const now = new Date().toISOString();
    await recalculateOccurrenceTotals(context.supabase, {
      workspaceId: context.workspaceId,
      occurrenceId,
      direction: "income",
      expectedAmountCents: Math.round(
        Number(occurrence.data.expected_amount ?? 0) * 100,
      ),
      competenceMonth: String(occurrence.data.competence_month),
      today: now.slice(0, 10),
      forceClosed: true,
    });
    const closed = await context.supabase
      .from("financial_commitment_occurrences")
      .update({ closed_at: now })
      .eq("workspace_id", context.workspaceId)
      .eq("id", occurrenceId);
    if (closed.error) throw new Error("Não foi possível fechar o mês.");
    await recalculateIncomeDefinitionStatistics(context.supabase, {
      workspaceId: context.workspaceId,
      commitmentId: String(occurrence.data.commitment_id),
      endMonth: addMonths(String(occurrence.data.competence_month), 1),
    });
    invalidateCommitmentsCache(context.workspaceId);
    return successfulFormResult("Competência fechada e mediana recalculada.");
  } catch (error) {
    return actionError(error, "Não foi possível fechar o mês.");
  }
}

export async function createIncomeFromReferenceMovement(
  data: FormData,
): Promise<FinanceFormResult> {
  return createHistoricalIncome(data);
}

export async function applyIncomeHistory(
  data: FormData,
): Promise<FinanceFormResult> {
  try {
    const workspaceId = uuid.parse(data.get("workspace_id"));
    const commitmentId = uuid.parse(data.get("commitment_id"));
    const context = await getActiveFinanceWorkspaceContext(workspaceId);
    const definition = await context.supabase.from("financial_commitments")
      .select(
        "id,source_record_id,expected_amount,expected_date_rule,expected_date_day",
      )
      .eq("workspace_id", context.workspaceId)
      .eq("id", commitmentId)
      .eq("cash_flow_direction", "income")
      .single();
    if (definition.error || !definition.data?.source_record_id) {
      return failedFormResult(
        "Esta receita não possui uma entrada de referência.",
      );
    }
    const preview = await getHistoricalIncomePreview(context.supabase, {
      workspaceId: context.workspaceId,
      userId: context.userId,
      referenceTransactionId: String(definition.data.source_record_id),
      endMonth: currentMonth(),
    });
    await linkIncomeTransactions(context.supabase, {
      workspaceId: context.workspaceId,
      userId: context.userId,
      commitmentId,
      expectedAmountCents: preview.statistics.medianAmount ??
        Math.round(Number(definition.data.expected_amount ?? 0) * 100),
      expectedAmountSource: preview.statistics.medianAmount === null
        ? "system_fallback"
        : "historical_median",
      expectedDateRule: String(
        definition.data.expected_date_rule ?? "unspecified_in_month",
      ) as ExpectedDateRule,
      expectedDateDay: definition.data.expected_date_day == null
        ? null
        : Number(definition.data.expected_date_day),
      transactions: preview.matchingTransactions,
      linkSource: "historical_backfill",
    });
    await recalculateIncomeDefinitionStatistics(context.supabase, {
      workspaceId: context.workspaceId,
      commitmentId,
      endMonth: currentMonth(),
    });
    invalidateCommitmentsCache(context.workspaceId);
    return successfulFormResult(
      `Histórico aplicado: ${preview.matchingTransactions.length} crédito(s) encontrados.`,
    );
  } catch (error) {
    return actionError(error, "Não foi possível aplicar o histórico.");
  }
}

export async function applyIncomeSourceToHistoricalTransactions(
  data: FormData,
): Promise<FinanceFormResult> {
  return applyIncomeHistory(data);
}

export async function updateIncomeDefinition(
  data: FormData,
): Promise<FinanceFormResult> {
  try {
    const workspaceId = uuid.parse(data.get("workspace_id"));
    const commitmentId = uuid.parse(data.get("commitment_id"));
    const title = z.string().trim().min(1).max(160).parse(data.get("title"));
    const status = z.enum(["active", "paused", "completed"]).parse(
      data.get("status") || "active",
    );
    const conservativeText = String(
      data.get("conservative_planning_amount") ?? "",
    ).trim();
    const conservativeCents = conservativeText
      ? parseBrazilianMoneyToCents(conservativeText)
      : null;
    if (conservativeText && conservativeCents === null) {
      return failedFormResult("Informe um valor conservador válido.");
    }
    const context = await getActiveFinanceWorkspaceContext(workspaceId);
    const updated = await context.supabase.from("financial_commitments")
      .update({
        title,
        status,
        conservative_planning_amount: conservativeCents === null
          ? null
          : conservativeCents / 100,
        planning_enabled: data.get("planning_enabled") !== "false",
        updated_at: new Date().toISOString(),
      })
      .eq("workspace_id", context.workspaceId)
      .eq("id", commitmentId)
      .eq("cash_flow_direction", "income")
      .select("id")
      .single();
    if (updated.error || !updated.data) {
      throw new Error("Não foi possível atualizar a receita.");
    }
    invalidateCommitmentsCache(context.workspaceId);
    return successfulFormResult("Receita atualizada.");
  } catch (error) {
    return actionError(error, "Não foi possível atualizar a receita.");
  }
}

const expensePaymentMethodSchema = z.enum([
  "bank_debit",
  "credit_card",
  "payroll",
  "pix",
  "boleto",
  "cash",
  "transfer",
  "other",
]);

const optionalUuid = (value: FormDataEntryValue | null) => {
  const text = String(value ?? "").trim();
  return text ? uuid.parse(text) : null;
};

export async function updateExpenseDefinition(
  data: FormData,
): Promise<FinanceFormResult> {
  try {
    const requestedWorkspaceId = uuid.parse(data.get("workspace_id"));
    const commitmentId = uuid.parse(data.get("commitment_id"));
    const month = z.string().regex(/^\d{4}-\d{2}$/).parse(data.get("month"));
    const title = z.string().trim().min(1).max(160).parse(data.get("title"));
    const descriptionText = String(data.get("description") ?? "").trim();
    const amountCents = parseBrazilianMoneyToCents(
      String(data.get("amount") ?? ""),
    );
    if (amountCents === null || amountCents < 0) {
      return failedFormResult("Informe um valor válido.");
    }
    const paymentMethod = expensePaymentMethodSchema.parse(
      data.get("payment_method"),
    );
    const categoryId = optionalUuid(data.get("category_id"));
    const personId = optionalUuid(data.get("person_id"));
    const selectedAccountId = optionalUuid(data.get("account_id"));
    const selectedCardId = optionalUuid(data.get("card_id"));
    const accountId = paymentMethod === "credit_card" ||
        paymentMethod === "payroll"
      ? null
      : selectedAccountId;
    const cardId = paymentMethod === "credit_card" ? selectedCardId : null;
    if (paymentMethod === "credit_card" && !cardId) {
      return failedFormResult("Escolha o cartão usado nesta despesa.");
    }
    const dueDayText = String(data.get("due_day") ?? "").trim();
    const dueDay = dueDayText
      ? z.coerce.number().int().min(1).max(31).parse(dueDayText)
      : null;
    const context = await getActiveFinanceWorkspaceContext(
      requestedWorkspaceId,
    );
    const current = await context.supabase.from("financial_commitments")
      .select("id,commitment_type,recurrence_frequency")
      .eq("workspace_id", context.workspaceId)
      .eq("id", commitmentId)
      .eq("cash_flow_direction", "expense")
      .single();
    if (current.error || !current.data) {
      throw new Error("Despesa não encontrada.");
    }
    const effects = resolveCommitmentFinancialEffects({
      direction: "expense",
      commitmentType: paymentMethod === "payroll"
        ? "payroll_deduction"
        : String(current.data.commitment_type),
      paymentMethod,
      isPayrollDeduction: paymentMethod === "payroll",
    });
    const updated = await context.supabase.from("financial_commitments")
      .update({
        title,
        description: descriptionText || null,
        expected_amount: amountCents / 100,
        category_id: categoryId,
        account_id: accountId,
        card_id: cardId,
        payment_method: paymentMethod,
        due_day: dueDay,
        expected_date_day: dueDay,
        expected_date_rule: dueDay ? "fixed_day" : "unspecified_in_month",
        commitment_type: paymentMethod === "payroll"
          ? "payroll_deduction"
          : current.data.commitment_type === "payroll_deduction"
            ? "recurring"
            : current.data.commitment_type,
        is_payroll_deduction: effects.isPayrollDeduction,
        income_basis: effects.incomeBasis,
        cash_flow_effect: effects.cashFlowEffect,
        planning_effect: effects.planningEffect,
        analytics_effect: effects.analyticsEffect,
        payment_channel: effects.paymentChannel,
        updated_at: new Date().toISOString(),
      })
      .eq("workspace_id", context.workspaceId)
      .eq("id", commitmentId)
      .select("id")
      .single();
    if (updated.error || !updated.data) {
      throw new Error("Não foi possível atualizar a despesa.");
    }

    const existingPeople = await context.supabase.from("commitment_people")
      .select("person_id")
      .eq("workspace_id", context.workspaceId)
      .eq("commitment_id", commitmentId)
      .eq("is_primary", true);
    if (existingPeople.error) {
      throw new Error("A despesa foi atualizada, mas a pessoa não pôde ser verificada.");
    }
    const oldPersonIds = (existingPeople.data ?? [])
      .map(row => String(row.person_id));
    if (personId) {
      const demoted = await context.supabase.from("commitment_people")
        .update({ is_primary: false })
        .eq("workspace_id", context.workspaceId)
        .eq("commitment_id", commitmentId);
      if (demoted.error) throw new Error("Não foi possível ajustar a pessoa.");
      const linked = await context.supabase.from("commitment_people").upsert({
        workspace_id: context.workspaceId,
        created_by: context.userId,
        commitment_id: commitmentId,
        person_id: personId,
        allocation_type: "full",
        allocation_value: 100,
        is_primary: true,
      }, { onConflict: "commitment_id,person_id" });
      if (linked.error) throw new Error("Não foi possível vincular a pessoa.");
    } else if (oldPersonIds.length) {
      const removed = await context.supabase.from("commitment_people")
        .delete()
        .eq("workspace_id", context.workspaceId)
        .eq("commitment_id", commitmentId)
        .in("person_id", oldPersonIds);
      if (removed.error) throw new Error("Não foi possível remover a pessoa.");
    }

    const occurrences = await context.supabase
      .from("financial_commitment_occurrences")
      .select("id,competence_month,status")
      .eq("workspace_id", context.workspaceId)
      .eq("commitment_id", commitmentId)
      .gte("competence_month", `${month}-01`)
      .not("status", "in", "(cancelled,skipped)");
    if (occurrences.error) {
      throw new Error("A despesa foi atualizada, mas as competências não puderam ser ajustadas.");
    }
    for (const occurrence of occurrences.data ?? []) {
      const competenceMonth = String(occurrence.competence_month);
      const occurrenceUpdate = await context.supabase
        .from("financial_commitment_occurrences")
        .update({
          expected_amount: amountCents / 100,
          expected_due_date: resolveExpectedBusinessDate({
            month: competenceMonth,
            rule: dueDay ? "fixed_day" : "unspecified_in_month",
            fixedDay: dueDay,
          }),
          updated_at: new Date().toISOString(),
        })
        .eq("workspace_id", context.workspaceId)
        .eq("id", String(occurrence.id));
      if (occurrenceUpdate.error) {
        throw new Error("A despesa foi atualizada, mas uma competência não pôde ser ajustada.");
      }
    }
    if (paymentMethod === "credit_card") {
      await context.supabase.rpc("reconcile_card_commitment_invoices", {
        p_workspace_id: context.workspaceId,
        p_commitment_id: commitmentId,
      });
    }
    invalidateCommitmentsCache(context.workspaceId, {
      month,
      personId: personId ?? oldPersonIds[0],
    });
    return successfulFormResult("Despesa atualizada.");
  } catch (error) {
    return actionError(error, "Não foi possível atualizar a despesa.");
  }
}

export async function recognizeExpensePaymentSource(
  data: FormData,
): Promise<FinanceFormResult> {
  try {
    const requestedWorkspaceId = uuid.parse(data.get("workspace_id"));
    const commitmentId = uuid.parse(data.get("commitment_id"));
    const occurrenceId = uuid.parse(data.get("occurrence_id"));
    const transactionId = uuid.parse(data.get("transaction_id"));
    const month = z.string().regex(/^\d{4}-\d{2}$/).parse(data.get("month"));
    const context = await getActiveFinanceWorkspaceContext(
      requestedWorkspaceId,
    );
    const occurrence = await context.supabase
      .from("financial_commitment_occurrences")
      .select("id,commitment_id,linked_transaction_id")
      .eq("workspace_id", context.workspaceId)
      .eq("id", occurrenceId)
      .eq("commitment_id", commitmentId)
      .single();
    if (
      occurrence.error ||
      !occurrence.data ||
      String(occurrence.data.linked_transaction_id ?? "") !== transactionId
    ) {
      return failedFormResult(
        "O pagamento vinculado não foi encontrado nesta despesa.",
      );
    }
    const linked = await context.supabase.rpc(
      "link_financial_transaction_to_occurrence",
      {
        p_workspace_id: context.workspaceId,
        p_occurrence_id: occurrenceId,
        p_transaction_id: transactionId,
        p_replace_existing: false,
      },
    );
    if (linked.error) {
      throw new Error("Não foi possível reconhecer os pagamentos deste destino.");
    }
    invalidateCommitmentsCache(context.workspaceId, { month });
    return successfulFormResult(
      "Pagamentos do mesmo destino atualizados nesta despesa.",
    );
  } catch (error) {
    return actionError(
      error,
      "Não foi possível reconhecer os pagamentos deste destino.",
    );
  }
}
