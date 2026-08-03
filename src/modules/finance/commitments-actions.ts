"use server";

import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { throwSupabaseError } from "@/lib/errors";
import { requireFinanceAccess } from "./access";
import { invalidateCommitmentsCache } from "./commitments-cache";
import {
  centsToMoney,
  moneyToCents,
  scoreCommitmentMatch,
  updateOccurrenceStatuses,
  validateAllocations,
  type CommitmentPersonAllocation,
} from "./commitments";
import {
  ensureCommitmentOccurrenceWindow,
  persistCommitmentOccurrences,
  refreshCommitmentNextDueDate,
} from "./commitment-occurrence-service";
import { mapCommitment, mapOccurrence } from "./commitments-query";
import {
  failedFormResult,
  successfulFormResult,
  type FinanceFormResult,
} from "./commitment-form-result";
import {
  parseBrazilianMoneyToCents,
  parseCommitmentNaturalLanguage,
  relationTargetParts,
  simpleCommitmentSchema,
  type ParsedCommitmentText,
} from "./simple-commitments";
import { resolveCommitmentFinancialEffects } from "./financial-impact";

const uuid = z.string().uuid();
const optionalUuid = z.union([z.string().uuid(), z.literal("")])
  .transform(value => value || null);
const amount = z.coerce.number().finite().nonnegative();
const decimalAmount = z.preprocess(value => {
  const text = String(value ?? "").trim();
  const normalized = text.includes(",")
    ? text.replace(/\./g, "").replace(",", ".")
    : text;
  return normalized === "" ? undefined : Number(normalized);
}, z.number().finite().positive());
const commitmentTag = z.enum([
  "required", "essential", "health", "education", "dependent", "subscription",
]);

const personSchema = z.object({
  workspace_id: uuid,
  name: z.string().trim().min(1).max(120),
  relation_type: z.enum([
    "daughter", "son", "wife", "husband", "ex_spouse",
    "mother", "father", "other_dependent", "child", "spouse", "parent",
    "dependent", "family", "other",
  ]),
  is_dependent: z.boolean(),
  notes: z.string().trim().max(1000).nullable(),
  color_key: z.string().trim().max(40).nullable(),
});

const commitmentSchema = z.object({
  workspace_id: uuid,
  title: z.string().trim().min(1).max(160),
  description: z.string().trim().max(1000).nullable(),
  commitment_type: z.enum([
    "recurring", "one_time", "installment", "subscription",
    "payroll_deduction", "manual", "other",
  ]),
  recurrence_frequency: z.enum([
    "weekly", "biweekly", "monthly", "bimonthly", "quarterly",
    "semiannual", "annual", "custom",
  ]).nullable(),
  recurrence_interval: z.coerce.number().int().min(1).max(120),
  amount_type: z.enum(["fixed", "variable", "estimated"]),
  expected_amount: decimalAmount,
  minimum_expected_amount: amount.nullable(),
  maximum_expected_amount: amount.nullable(),
  category_id: optionalUuid,
  account_id: optionalUuid,
  card_id: optionalUuid,
  payment_method: z.enum([
    "bank_debit", "credit_card", "payroll", "pix", "boleto",
    "cash", "transfer", "other",
  ]).nullable(),
  due_day: z.coerce.number().int().min(1).max(31).nullable(),
  due_date: z.string().date().nullable(),
  start_date: z.string().date(),
  end_date: z.string().date().nullable(),
  auto_match_enabled: z.boolean(),
  merchant_match_pattern: z.string().trim().max(160).nullable(),
  person_id: optionalUuid,
  allocation_type: z.enum(["full", "percentage", "fixed_amount"]),
  allocation_value: z.coerce.number().finite().nonnegative(),
  cash_flow_direction: z.enum(["expense", "income"]),
  include_in_monthly_budget: z.boolean(),
  generates_future_projections: z.boolean(),
  same_invoice: z.boolean(),
  tags: z.array(commitmentTag),
  projection_confirmation: z.boolean(),
  shared_expense_enabled: z.boolean(),
  beneficiary_person_id: optionalUuid,
  user_responsibility_type: z.enum([
    "full", "percentage", "fixed_amount",
  ]).nullable(),
  user_responsibility_value: amount.nullable(),
  reimbursement_person_id: optionalUuid,
  reimbursement_allocation_type: z.enum([
    "full", "percentage", "fixed_amount", "remainder",
  ]).nullable(),
  reimbursement_allocation_value: amount.nullable(),
  analysis_group_id: optionalUuid,
}).superRefine((value, context) => {
  if (value.same_invoice && !value.card_id) {
    context.addIssue({
      code: "custom",
      path: ["card_id"],
      message: "Selecione o cartão usado por este compromisso.",
    });
  }
  if (value.shared_expense_enabled) {
    if (!value.beneficiary_person_id) {
      context.addIssue({
        code: "custom", path: ["beneficiary_person_id"],
        message: "Selecione o beneficiário da despesa compartilhada.",
      });
    }
    if (!value.reimbursement_person_id) {
      context.addIssue({
        code: "custom", path: ["reimbursement_person_id"],
        message: "Selecione quem reembolsará a outra parte.",
      });
    }
    if (!value.user_responsibility_type ||
      value.user_responsibility_value === null) {
      context.addIssue({
        code: "custom", path: ["user_responsibility_value"],
        message: "Informe a parte assumida por você.",
      });
    }
    if (!value.reimbursement_allocation_type ||
      value.reimbursement_allocation_value === null) {
      context.addIssue({
        code: "custom", path: ["reimbursement_allocation_value"],
        message: "Informe a regra da parte reembolsável.",
      });
    }
  }
});

const nullable = (value: FormDataEntryValue | null) => {
  const text = String(value ?? "").trim();
  return text || null;
};
const checked = (data: FormData, key: string) =>
  ["on", "true", "1"].includes(String(data.get(key) ?? ""));
const selectedTags = (data: FormData) =>
  data.getAll("tags").map(String).filter(value =>
    commitmentTag.options.includes(value as (typeof commitmentTag.options)[number])
  );

async function recordCommitmentHistory(input: {
  supabase: SupabaseClient;
  workspaceId: string;
  commitmentId: string;
  userId: string;
  eventType: string;
  summary: string;
  effectiveFrom?: string | null;
}) {
  await input.supabase.from("financial_commitment_history").insert({
    workspace_id: input.workspaceId,
    commitment_id: input.commitmentId,
    created_by: input.userId,
    event_type: input.eventType,
    summary: input.summary,
    effective_from: input.effectiveFrom ?? null,
  });
}

function fieldErrorsFromZod(error: z.ZodError) {
  const fieldLabels: Record<string, string> = {
    title: "nome do compromisso",
    name: "nome",
    relation_type: "relação",
    expected_amount: "valor previsto",
    recurrence_frequency: "frequência",
    recurrence_interval: "intervalo",
    start_date: "data de início",
    due_day: "dia de vencimento",
    card_id: "cartão",
    projection_confirmation: "confirmação",
  };
  const errors: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const field = String(issue.path[0] ?? "form");
    const label = fieldLabels[field] ?? "campo";
    const message = issue.code === "custom"
      ? issue.message
      : issue.code === "too_small"
        ? `Informe um ${label} válido.`
        : issue.code === "too_big"
          ? `O ${label} ultrapassa o limite permitido.`
          : `Revise o ${label}.`;
    errors[field] = [...(errors[field] ?? []), message];
  }
  return errors;
}

function friendlyActionFailure(
  error: unknown,
  fallback: string,
): FinanceFormResult {
  if (error instanceof z.ZodError) {
    return failedFormResult(
      "Revise os campos destacados antes de continuar.",
      fieldErrorsFromZod(error),
    );
  }
  const message = error instanceof Error ? error.message : "";
  if (/pessoa j[aá] est[aá] cadastrada/i.test(message)) {
    return failedFormResult(
      "Esta pessoa já está cadastrada.",
      { name: ["Use outro nome ou edite o cadastro existente."] },
    );
  }
  if (/semelhante|j[aá] existe/i.test(message)) {
    return failedFormResult(
      "Já existe um cadastro semelhante.",
      { title: ["Use outro nome ou edite o compromisso existente."] },
    );
  }
  return failedFormResult(fallback);
}

async function requireWorkspace(workspaceId: string) {
  const access = await requireFinanceAccess();
  const workspace = await access.supabase.from("workspaces")
    .select("id,owner_id").eq("id", workspaceId).maybeSingle();
  if (workspace.error || !workspace.data) {
    throw new Error("Espaço financeiro inválido ou sem permissão.");
  }
  const member = await access.supabase.from("workspace_members")
    .select("role,status").eq("workspace_id", workspaceId)
    .eq("user_id", access.user.id).eq("status", "active").maybeSingle();
  const canEdit = workspace.data.owner_id === access.user.id ||
    ["owner", "admin", "editor"].includes(String(member.data?.role ?? ""));
  if (!canEdit) throw new Error("Você não pode editar este espaço financeiro.");
  return access;
}

const commitmentRowSelect =
  "id,workspace_id,title,description,commitment_type,recurrence_frequency,recurrence_interval,amount_type,expected_amount,minimum_expected_amount,maximum_expected_amount,currency_code,category_id,account_id,card_id,payment_method,due_day,due_date,start_date,end_date,next_due_date,status,auto_match_enabled,merchant_match_pattern,description_match_pattern,expected_day_tolerance,expected_amount_tolerance,source,source_record_id,is_payroll_deduction,generates_future_projections,last_generated_until,cash_flow_direction,include_in_monthly_budget,same_invoice,tags,shared_expense_enabled,beneficiary_person_id,user_responsibility_type,user_responsibility_value,reimbursement_person_id,reimbursement_allocation_type,reimbursement_allocation_value,analysis_group_id,financial_analysis_groups(id,name,group_type)";

export async function createFinancialPerson(data: FormData) {
  const parsed = personSchema.parse({
    workspace_id: data.get("workspace_id"),
    name: data.get("name"),
    relation_type: data.get("relation_type"),
    is_dependent: checked(data, "is_dependent"),
    notes: nullable(data.get("notes")),
    color_key: nullable(data.get("color_key")),
  });
  const { supabase, user } = await requireWorkspace(parsed.workspace_id);
  const duplicate = await supabase.from("financial_people").select("id")
    .eq("workspace_id", parsed.workspace_id)
    .ilike("name", parsed.name).eq("relation_type", parsed.relation_type)
    .is("archived_at", null).limit(1).maybeSingle();
  if (duplicate.data) throw new Error("Esta pessoa já está cadastrada.");
  const result = await supabase.from("financial_people").insert({
    workspace_id: parsed.workspace_id,
    created_by: user.id,
    name: parsed.name,
    relation_type: parsed.relation_type,
    is_dependent: parsed.is_dependent,
    notes: parsed.notes,
    color_key: parsed.color_key,
    visibility: "private",
  });
  if (result.error) {
    throwSupabaseError(
      result.error,
      "createFinancialPerson",
      "Não foi possível cadastrar a pessoa.",
    );
  }
  invalidateCommitmentsCache(parsed.workspace_id);
}

export async function archiveFinancialPerson(data: FormData) {
  const workspaceId = uuid.parse(data.get("workspace_id"));
  const personId = uuid.parse(data.get("person_id"));
  const { supabase, user } = await requireWorkspace(workspaceId);
  const result = await supabase.from("financial_people").update({
    is_active: false,
    archived_at: new Date().toISOString(),
  }).eq("id", personId).eq("workspace_id", workspaceId)
    .eq("created_by", user.id);
  if (result.error) {
    throwSupabaseError(
      result.error,
      "archiveFinancialPerson",
      "Não foi possível arquivar a pessoa.",
    );
  }
  invalidateCommitmentsCache(workspaceId, { personId });
}

export async function updateFinancialPerson(data: FormData) {
  const personId = uuid.parse(data.get("person_id"));
  const parsed = personSchema.parse({
    workspace_id: data.get("workspace_id"),
    name: data.get("name"),
    relation_type: data.get("relation_type"),
    is_dependent: checked(data, "is_dependent"),
    notes: nullable(data.get("notes")),
    color_key: nullable(data.get("color_key")),
  });
  const { supabase, user } = await requireWorkspace(parsed.workspace_id);
  const result = await supabase.from("financial_people").update({
    name: parsed.name,
    relation_type: parsed.relation_type,
    is_dependent: parsed.is_dependent,
    notes: parsed.notes,
    color_key: parsed.color_key,
  }).eq("workspace_id", parsed.workspace_id).eq("id", personId)
    .eq("created_by", user.id);
  if (result.error) {
    throwSupabaseError(
      result.error,
      "updateFinancialPerson",
      "Não foi possível atualizar a pessoa.",
    );
  }
  invalidateCommitmentsCache(parsed.workspace_id, { personId });
}

export async function saveFinancialPersonForm(
  data: FormData,
): Promise<FinanceFormResult> {
  try {
    const personId = nullable(data.get("person_id"));
    if (personId) await updateFinancialPerson(data);
    else await createFinancialPerson(data);
    return successfulFormResult(
      personId ? "Pessoa atualizada com sucesso." : "Pessoa adicionada com sucesso.",
      personId ?? undefined,
    );
  } catch (error) {
    return friendlyActionFailure(
      error,
      "Não foi possível salvar a pessoa. Revise os dados e tente novamente.",
    );
  }
}

export async function createFinancialCommitment(data: FormData) {
  const commitmentType = String(data.get("commitment_type") ?? "");
  const isOneTime = commitmentType === "one_time";
  const parsed = commitmentSchema.parse({
    workspace_id: data.get("workspace_id"),
    title: data.get("title"),
    description: nullable(data.get("description")),
    commitment_type: commitmentType,
    recurrence_frequency: isOneTime
      ? null
      : nullable(data.get("recurrence_frequency")),
    recurrence_interval: data.get("recurrence_interval") || 1,
    amount_type: data.get("amount_type"),
    expected_amount: nullable(data.get("expected_amount")),
    minimum_expected_amount: nullable(data.get("minimum_expected_amount")),
    maximum_expected_amount: nullable(data.get("maximum_expected_amount")),
    category_id: String(data.get("category_id") ?? ""),
    account_id: String(data.get("account_id") ?? ""),
    card_id: String(data.get("card_id") ?? ""),
    payment_method: nullable(data.get("payment_method")),
    due_day: isOneTime ? null : nullable(data.get("due_day")),
    due_date: isOneTime ? nullable(data.get("due_date")) : null,
    start_date: data.get("start_date"),
    end_date: nullable(data.get("end_date")),
    auto_match_enabled: checked(data, "auto_match_enabled"),
    merchant_match_pattern: nullable(data.get("merchant_match_pattern")),
    person_id: String(data.get("person_id") ?? ""),
    allocation_type: data.get("allocation_type") || "full",
    allocation_value: data.get("allocation_value") || 100,
    cash_flow_direction: data.get("cash_flow_direction") || "expense",
    include_in_monthly_budget: checked(data, "include_in_monthly_budget"),
    generates_future_projections: checked(data, "generates_future_projections"),
    same_invoice: checked(data, "same_invoice"),
    tags: selectedTags(data),
    projection_confirmation: checked(data, "projection_confirmation"),
    shared_expense_enabled: checked(data, "shared_expense_enabled"),
    beneficiary_person_id: String(data.get("beneficiary_person_id") ?? ""),
    user_responsibility_type: nullable(data.get("user_responsibility_type")),
    user_responsibility_value: nullable(data.get("user_responsibility_value")),
    reimbursement_person_id: String(data.get("reimbursement_person_id") ?? ""),
    reimbursement_allocation_type: nullable(
      data.get("reimbursement_allocation_type"),
    ),
    reimbursement_allocation_value: nullable(
      data.get("reimbursement_allocation_value"),
    ),
    analysis_group_id: String(data.get("analysis_group_id") ?? ""),
  });
  if (parsed.end_date && parsed.end_date < parsed.start_date) {
    throw new Error("A data final não pode ser anterior ao início.");
  }
  if (
    parsed.amount_type === "variable" &&
    parsed.minimum_expected_amount !== null &&
    parsed.maximum_expected_amount !== null &&
    parsed.minimum_expected_amount > parsed.maximum_expected_amount
  ) throw new Error("A faixa de valor é inválida.");
  const { supabase, user } = await requireWorkspace(parsed.workspace_id);
  const duplicate = await supabase.from("financial_commitments").select("id")
    .eq("workspace_id", parsed.workspace_id)
    .ilike("title", parsed.title)
    .eq("status", "active")
    .is("archived_at", null).limit(1).maybeSingle();
  if (duplicate.data) throw new Error("Já existe um compromisso ativo semelhante.");
  const expectedAmount = parsed.expected_amount;
  const financialEffects = resolveCommitmentFinancialEffects({
    direction: parsed.cash_flow_direction,
    commitmentType: parsed.commitment_type,
    paymentMethod: parsed.payment_method,
    isPayrollDeduction:
      parsed.commitment_type === "payroll_deduction" ||
      parsed.payment_method === "payroll",
  });
  const inserted = await supabase.from("financial_commitments").insert({
    workspace_id: parsed.workspace_id,
    created_by: user.id,
    visibility: "private",
    title: parsed.title,
    description: parsed.description,
    commitment_type: parsed.commitment_type,
    recurrence_frequency: parsed.recurrence_frequency,
    recurrence_interval: parsed.recurrence_interval,
    amount_type: parsed.amount_type,
    expected_amount: parsed.expected_amount,
    minimum_expected_amount: parsed.minimum_expected_amount,
    maximum_expected_amount: parsed.maximum_expected_amount,
    currency_code: "BRL",
    category_id: parsed.category_id,
    account_id: parsed.account_id,
    card_id: parsed.card_id,
    payment_method: parsed.payment_method,
    due_day: parsed.due_day,
    due_date: parsed.due_date,
    start_date: parsed.start_date,
    end_date: parsed.end_date,
    next_due_date: parsed.due_date ?? parsed.start_date,
    auto_match_enabled: parsed.auto_match_enabled &&
      parsed.commitment_type !== "payroll_deduction",
    merchant_match_pattern: parsed.merchant_match_pattern,
    source: "manual",
    is_payroll_deduction: financialEffects.isPayrollDeduction,
    income_basis: financialEffects.incomeBasis,
    cash_flow_effect: financialEffects.cashFlowEffect,
    planning_effect: financialEffects.planningEffect,
    analytics_effect: financialEffects.analyticsEffect,
    payment_channel: financialEffects.paymentChannel,
    generates_future_projections: parsed.generates_future_projections,
    cash_flow_direction: parsed.cash_flow_direction,
    include_in_monthly_budget: parsed.include_in_monthly_budget,
    same_invoice: parsed.same_invoice,
    tags: parsed.tags,
    shared_expense_enabled: parsed.shared_expense_enabled,
    beneficiary_person_id: parsed.beneficiary_person_id,
    user_responsibility_type: parsed.user_responsibility_type,
    user_responsibility_value: parsed.user_responsibility_value,
    reimbursement_person_id: parsed.reimbursement_person_id,
    reimbursement_allocation_type: parsed.reimbursement_allocation_type,
    reimbursement_allocation_value: parsed.reimbursement_allocation_value,
    analysis_group_id: parsed.analysis_group_id,
  }).select(commitmentRowSelect).single();
  if (inserted.error) {
    throwSupabaseError(
      inserted.error,
      "createFinancialCommitment",
      "Não foi possível cadastrar o compromisso.",
    );
  }
  const commitment = mapCommitment(
    inserted.data as unknown as Parameters<typeof mapCommitment>[0],
  );
  if (parsed.person_id) {
    const allocations: CommitmentPersonAllocation[] = [{
      personId: parsed.person_id,
      allocationType: parsed.allocation_type,
      allocationValue: parsed.allocation_value,
      isPrimary: true,
    }];
    const validation = validateAllocations(
      allocations,
      Math.round(expectedAmount * 100),
    );
    if (!validation.valid) throw new Error("A divisão entre pessoas é inválida.");
    const personLink = await supabase.from("commitment_people").insert({
      workspace_id: parsed.workspace_id,
      created_by: user.id,
      commitment_id: commitment.id,
      person_id: parsed.person_id,
      allocation_type: parsed.allocation_type,
      allocation_value: parsed.allocation_value,
      is_primary: true,
    });
    if (personLink.error) {
      throwSupabaseError(
        personLink.error,
        "createFinancialCommitment.person",
        "O compromisso foi criado, mas a pessoa não pôde ser vinculada.",
      );
    }
  }
  await ensureCommitmentOccurrenceWindow({
    supabase,
    userId: user.id,
    commitment,
    includeStartDate: true,
  });
  invalidateCommitmentsCache(parsed.workspace_id, {
    month: parsed.start_date.slice(0, 7),
    personId: parsed.person_id ?? undefined,
  });
  return commitment.id;
}

export async function createFinancialCommitmentForm(data: FormData) {
  try {
    const id = await createFinancialCommitment(data);
    return successfulFormResult("Compromisso criado com sucesso.", id);
  } catch (error) {
    return friendlyActionFailure(
      error,
      "Não foi possível salvar o compromisso. Tente novamente em instantes.",
    );
  }
}

const simpleFieldLabels: Record<string, string> = {
  title: "Informe o nome do compromisso.",
  amount: "Informe um valor válido.",
  scheduleDate: "Informe quando o compromisso acontece.",
  recurrence: "Escolha se o compromisso se repete.",
  relationTarget: "Selecione uma pessoa ou contexto válido.",
};

function simpleCommitmentFieldErrors(error: z.ZodError) {
  const result: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const field = String(issue.path[0] ?? "form");
    const message = issue.message &&
        !["Invalid input", "Invalid input: expected"].some(prefix =>
          issue.message.startsWith(prefix)
        )
      ? issue.message
      : simpleFieldLabels[field] ?? "Revise este campo.";
    result[field] = [...(result[field] ?? []), message];
  }
  return result;
}

export async function parseCommitmentText(
  data: FormData,
): Promise<{
  ok: boolean;
  message: string;
  parsed?: ParsedCommitmentText;
}> {
  try {
    const workspaceId = uuid.parse(data.get("workspace_id"));
    const text = z.string().trim().min(3).max(1000).parse(data.get("text"));
    const { supabase } = await requireWorkspace(workspaceId);
    const people = await supabase.from("financial_people")
      .select("name")
      .eq("workspace_id", workspaceId)
      .eq("is_active", true)
      .is("archived_at", null);
    if (people.error) {
      throwSupabaseError(
        people.error,
        "parseCommitmentText.people",
        "Não foi possível consultar as pessoas cadastradas.",
      );
    }
    const parsed = parseCommitmentNaturalLanguage(text, {
      peopleNames: (people.data ?? []).map(person => String(person.name)),
    });
    return {
      ok: true,
      message: parsed.missingFields.length
        ? "Preenchemos o que foi identificado. Complete os campos destacados."
        : "Revise os dados antes de adicionar.",
      parsed,
    };
  } catch {
    return {
      ok: false,
      message: "Não foi possível interpretar o texto. Prefira o preenchimento manual.",
    };
  }
}

export async function createSimpleCommitment(
  data: FormData,
): Promise<FinanceFormResult> {
  const workspaceIdResult = uuid.safeParse(data.get("workspace_id"));
  if (!workspaceIdResult.success) {
    return failedFormResult("Não foi possível identificar o espaço financeiro.");
  }
  try {
    const parsed = simpleCommitmentSchema.parse({
      title: data.get("title"),
      amount: data.get("amount"),
      scheduleDate: data.get("schedule_date"),
      recurrence: data.get("recurrence"),
      relationTarget: data.get("relation_target") || "personal",
      advanced: {
        categoryId: nullable(data.get("category_id")),
        paymentMethod: nullable(data.get("payment_method")),
        accountId: nullable(data.get("account_id")),
        cardId: nullable(data.get("card_id")),
        variableAmount: checked(data, "variable_amount"),
        minimumAmount: nullable(data.get("minimum_expected_amount")),
        maximumAmount: nullable(data.get("maximum_expected_amount")),
        endDate: nullable(data.get("end_date")),
        budgetPriority: data.get("budget_priority") || "unknown",
        notes: nullable(data.get("notes")),
        autoMatchEnabled: false,
      },
    });
    const workspaceId = workspaceIdResult.data;
    const { supabase, user } = await requireWorkspace(workspaceId);
    const relation = relationTargetParts(parsed.relationTarget);
    if (relation.personId) {
      const person = await supabase.from("financial_people")
        .select("id")
        .eq("workspace_id", workspaceId)
        .eq("id", relation.personId)
        .eq("is_active", true)
        .is("archived_at", null)
        .maybeSingle();
      if (person.error || !person.data) {
        return failedFormResult(
          "A pessoa selecionada não pertence a este espaço.",
          { relationTarget: ["Selecione uma pessoa válida."] },
        );
      }
    }
    const amountCents = parseBrazilianMoneyToCents(parsed.amount);
    if (amountCents === null) {
      return failedFormResult(
        "Revise os campos destacados antes de continuar.",
        { amount: ["Informe um valor válido."] },
      );
    }
    const technicalFrequency = parsed.recurrence === "none"
      ? ""
      : parsed.recurrence;
    const adapted = new FormData();
    adapted.set("workspace_id", workspaceId);
    adapted.set("title", parsed.title);
    adapted.set("description", parsed.advanced.notes ?? "");
    adapted.set(
      "commitment_type",
      parsed.recurrence === "none" ? "one_time" : "recurring",
    );
    adapted.set("recurrence_frequency", technicalFrequency);
    adapted.set("recurrence_interval", "1");
    adapted.set(
      "amount_type",
      parsed.advanced.variableAmount ? "variable" : "fixed",
    );
    adapted.set("expected_amount", String(amountCents / 100));
    adapted.set(
      "minimum_expected_amount",
      parsed.advanced.minimumAmount ?? "",
    );
    adapted.set(
      "maximum_expected_amount",
      parsed.advanced.maximumAmount ?? "",
    );
    adapted.set("category_id", parsed.advanced.categoryId ?? "");
    adapted.set("account_id", parsed.advanced.accountId ?? "");
    adapted.set("card_id", parsed.advanced.cardId ?? "");
    adapted.set("payment_method", parsed.advanced.paymentMethod ?? "");
    adapted.set(
      "due_day",
      parsed.recurrence === "none"
        ? ""
        : String(Number(parsed.scheduleDate.slice(8, 10))),
    );
    adapted.set(
      "due_date",
      parsed.recurrence === "none" ? parsed.scheduleDate : "",
    );
    adapted.set("start_date", parsed.scheduleDate);
    adapted.set("end_date", parsed.advanced.endDate ?? "");
    adapted.set(
      "auto_match_enabled",
      parsed.advanced.autoMatchEnabled ? "true" : "false",
    );
    adapted.set("merchant_match_pattern", "");
    adapted.set("person_id", relation.personId ?? "");
    adapted.set("allocation_type", "full");
    adapted.set("allocation_value", "100");
    adapted.set("cash_flow_direction", "expense");
    adapted.set("include_in_monthly_budget", "true");
    adapted.set("generates_future_projections", "true");
    adapted.set("projection_confirmation", "true");
    adapted.set("analysis_group_id", "");
    const commitmentId = await createFinancialCommitment(adapted);
    const isPayroll = parsed.advanced.paymentMethod === "payroll";
    const contextUpdate = await supabase.from("financial_commitments").update({
      context_type: relation.contextType,
      budget_priority: parsed.advanced.budgetPriority,
      natural_language_source: nullable(data.get("natural_language_source")),
      notes: parsed.advanced.notes,
      is_payroll_deduction: isPayroll,
    }).eq("workspace_id", workspaceId).eq("id", commitmentId);
    if (contextUpdate.error) {
      await supabase.from("financial_commitments").delete()
        .eq("workspace_id", workspaceId).eq("id", commitmentId);
      throwSupabaseError(
        contextUpdate.error,
        "createSimpleCommitment.context",
        "Não foi possível salvar o contexto do compromisso.",
      );
    }
    if (isPayroll) {
      await supabase.from("financial_commitment_occurrences").update({
        status: "expected",
      }).eq("workspace_id", workspaceId)
        .eq("commitment_id", commitmentId)
        .in("status", ["pending", "overdue", "expected"]);
    }
    await supabase.from("financial_commitment_history").insert({
      workspace_id: workspaceId,
      commitment_id: commitmentId,
      created_by: user.id,
      event_type: "created",
      summary: "Compromisso criado.",
    });
    invalidateCommitmentsCache(workspaceId, {
      month: parsed.scheduleDate.slice(0, 7),
      personId: relation.personId ?? undefined,
    });
    return successfulFormResult("Compromisso adicionado.", commitmentId);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return failedFormResult(
        "Revise os campos destacados antes de continuar.",
        simpleCommitmentFieldErrors(error),
      );
    }
    return friendlyActionFailure(
      error,
      "Não foi possível adicionar o compromisso. Tente novamente.",
    );
  }
}

export async function updateFinancialCommitment(data: FormData) {
  const commitmentId = uuid.parse(data.get("commitment_id"));
  const parsed = commitmentSchema.parse({
    workspace_id: data.get("workspace_id"),
    title: data.get("title"),
    description: nullable(data.get("description")),
    commitment_type: data.get("commitment_type") || "recurring",
    recurrence_frequency: nullable(data.get("recurrence_frequency")),
    recurrence_interval: data.get("recurrence_interval") || 1,
    amount_type: data.get("amount_type") || "fixed",
    expected_amount: data.get("expected_amount"),
    minimum_expected_amount: nullable(data.get("minimum_expected_amount")),
    maximum_expected_amount: nullable(data.get("maximum_expected_amount")),
    category_id: String(data.get("category_id") ?? ""),
    account_id: String(data.get("account_id") ?? ""),
    card_id: String(data.get("card_id") ?? ""),
    payment_method: nullable(data.get("payment_method")),
    due_day: nullable(data.get("due_day")),
    due_date: null,
    start_date: data.get("start_date"),
    end_date: nullable(data.get("end_date")),
    auto_match_enabled: checked(data, "auto_match_enabled"),
    merchant_match_pattern: nullable(data.get("merchant_match_pattern")),
    person_id: String(data.get("person_id") ?? ""),
    allocation_type: "full",
    allocation_value: 100,
    cash_flow_direction: data.get("cash_flow_direction") || "expense",
    include_in_monthly_budget: checked(data, "include_in_monthly_budget"),
    generates_future_projections: checked(data, "generates_future_projections"),
    same_invoice: checked(data, "same_invoice"),
    tags: selectedTags(data),
    projection_confirmation: checked(data, "projection_confirmation"),
    shared_expense_enabled: checked(data, "shared_expense_enabled"),
    beneficiary_person_id: String(data.get("beneficiary_person_id") ?? ""),
    user_responsibility_type: nullable(data.get("user_responsibility_type")),
    user_responsibility_value: nullable(data.get("user_responsibility_value")),
    reimbursement_person_id: String(data.get("reimbursement_person_id") ?? ""),
    reimbursement_allocation_type: nullable(
      data.get("reimbursement_allocation_type"),
    ),
    reimbursement_allocation_value: nullable(
      data.get("reimbursement_allocation_value"),
    ),
    analysis_group_id: String(data.get("analysis_group_id") ?? ""),
  });
  const { supabase, user } = await requireWorkspace(parsed.workspace_id);
  const financialEffects = resolveCommitmentFinancialEffects({
    direction: parsed.cash_flow_direction,
    commitmentType: parsed.commitment_type,
    paymentMethod: parsed.payment_method,
    isPayrollDeduction:
      parsed.commitment_type === "payroll_deduction" ||
      parsed.payment_method === "payroll",
  });
  const result = await supabase.from("financial_commitments").update({
    title: parsed.title,
    description: parsed.description,
    commitment_type: parsed.commitment_type,
    recurrence_frequency: parsed.recurrence_frequency,
    recurrence_interval: parsed.recurrence_interval,
    amount_type: parsed.amount_type,
    expected_amount: parsed.expected_amount,
    category_id: parsed.category_id,
    account_id: parsed.account_id,
    card_id: parsed.card_id,
    payment_method: parsed.payment_method,
    is_payroll_deduction: financialEffects.isPayrollDeduction,
    income_basis: financialEffects.incomeBasis,
    cash_flow_effect: financialEffects.cashFlowEffect,
    planning_effect: financialEffects.planningEffect,
    analytics_effect: financialEffects.analyticsEffect,
    payment_channel: financialEffects.paymentChannel,
    due_day: parsed.due_day,
    start_date: parsed.start_date,
    end_date: parsed.end_date,
    auto_match_enabled: parsed.auto_match_enabled,
    merchant_match_pattern: parsed.merchant_match_pattern,
    generates_future_projections: parsed.generates_future_projections,
    cash_flow_direction: parsed.cash_flow_direction,
    include_in_monthly_budget: parsed.include_in_monthly_budget,
    same_invoice: parsed.same_invoice,
    tags: parsed.tags,
    shared_expense_enabled: parsed.shared_expense_enabled,
    beneficiary_person_id: parsed.beneficiary_person_id,
    user_responsibility_type: parsed.user_responsibility_type,
    user_responsibility_value: parsed.user_responsibility_value,
    reimbursement_person_id: parsed.reimbursement_person_id,
    reimbursement_allocation_type: parsed.reimbursement_allocation_type,
    reimbursement_allocation_value: parsed.reimbursement_allocation_value,
    analysis_group_id: parsed.analysis_group_id,
  }).eq("workspace_id", parsed.workspace_id).eq("id", commitmentId)
    .select(commitmentRowSelect).single();
  if (result.error) {
    throwSupabaseError(
      result.error,
      "updateFinancialCommitment",
      "Não foi possível atualizar o compromisso.",
    );
  }
  const existingPrimary = await supabase.from("commitment_people")
    .select("person_id").eq("workspace_id", parsed.workspace_id)
    .eq("commitment_id", commitmentId).eq("is_primary", true);
  if (existingPrimary.error) {
    throwSupabaseError(
      existingPrimary.error,
      "updateFinancialCommitment.person.read",
      "O compromisso foi atualizado, mas o vínculo com a pessoa não pôde ser verificado.",
    );
  }
  const oldPrimaryIds = (existingPrimary.data ?? []).map(row =>
    String(row.person_id)
  );
  if (parsed.person_id) {
    const demoted = await supabase.from("commitment_people")
      .update({ is_primary: false }).eq("workspace_id", parsed.workspace_id)
      .eq("commitment_id", commitmentId);
    if (demoted.error) {
      throwSupabaseError(
        demoted.error,
        "updateFinancialCommitment.person.demote",
        "O compromisso foi atualizado, mas o vínculo anterior não pôde ser ajustado.",
      );
    }
    const linked = await supabase.from("commitment_people").upsert({
      workspace_id: parsed.workspace_id,
      created_by: user.id,
      commitment_id: commitmentId,
      person_id: parsed.person_id,
      allocation_type: "full",
      allocation_value: 100,
      is_primary: true,
    }, { onConflict: "commitment_id,person_id" });
    if (linked.error) {
      throwSupabaseError(
        linked.error,
        "updateFinancialCommitment.person.link",
        "O compromisso foi atualizado, mas a pessoa não pôde ser vinculada.",
      );
    }
  } else if (oldPrimaryIds.length) {
    const unlinked = await supabase.from("commitment_people").delete()
      .eq("workspace_id", parsed.workspace_id)
      .eq("commitment_id", commitmentId).in("person_id", oldPrimaryIds);
    if (unlinked.error) {
      throwSupabaseError(
        unlinked.error,
        "updateFinancialCommitment.person.unlink",
        "O compromisso foi atualizado, mas o vínculo anterior não pôde ser removido.",
      );
    }
  }
  const today = new Date().toISOString().slice(0, 10);
  const cleared = await supabase.from("financial_commitment_occurrences")
    .delete().eq("workspace_id", parsed.workspace_id)
    .eq("commitment_id", commitmentId)
    .gte("expected_due_date", today)
    .in("status", ["projected", "expected", "pending"])
    .is("linked_transaction_id", null)
    .is("linked_card_movement_id", null);
  if (cleared.error) {
    throwSupabaseError(
      cleared.error,
      "updateFinancialCommitment.occurrences",
      "Os dados foram atualizados, mas as projeções futuras não puderam ser recalculadas.",
    );
  }
  const commitment = mapCommitment(
    result.data as unknown as Parameters<typeof mapCommitment>[0],
  );
  await persistCommitmentOccurrences({
    supabase,
    userId: user.id,
    commitment,
  });
  invalidateCommitmentsCache(parsed.workspace_id, {
    month: parsed.start_date.slice(0, 7),
    personId: parsed.person_id ?? oldPrimaryIds[0],
  });
}

export async function updateFinancialCommitmentForm(
  data: FormData,
): Promise<FinanceFormResult> {
  try {
    const id = uuid.parse(data.get("commitment_id"));
    await updateFinancialCommitment(data);
    return successfulFormResult("Compromisso atualizado com sucesso.", id);
  } catch (error) {
    return friendlyActionFailure(
      error,
      "Não foi possível atualizar o compromisso. Tente novamente em instantes.",
    );
  }
}

export async function updateSimpleCommitment(
  data: FormData,
): Promise<FinanceFormResult> {
  return updateFinancialCommitmentForm(data);
}

async function updateCommitmentStatus(data: FormData, status: string) {
  const workspaceId = uuid.parse(data.get("workspace_id"));
  const commitmentId = uuid.parse(data.get("commitment_id"));
  const { supabase, user } = await requireWorkspace(workspaceId);
  const result = await supabase.from("financial_commitments").update({
    status,
    ...(status === "archived"
      ? { archived_at: new Date().toISOString() }
      : {}),
  }).eq("id", commitmentId).eq("workspace_id", workspaceId);
  if (result.error) {
    throwSupabaseError(
      result.error,
      "updateFinancialCommitment.status",
      "Não foi possível atualizar o compromisso.",
    );
  }
  const history = status === "paused"
    ? ["paused", "Compromisso pausado."]
    : status === "active"
      ? ["resumed", "Compromisso retomado."]
      : status === "completed"
        ? ["ended", "Compromisso encerrado."]
        : null;
  if (history) {
    await recordCommitmentHistory({
      supabase,
      workspaceId,
      commitmentId,
      userId: user.id,
      eventType: history[0],
      summary: history[1],
    });
  }
  invalidateCommitmentsCache(workspaceId);
}

export async function pauseFinancialCommitment(data: FormData) {
  await updateCommitmentStatus(data, "paused");
}
export async function pauseCommitment(data: FormData) {
  await pauseFinancialCommitment(data);
}
export async function resumeFinancialCommitment(data: FormData) {
  await updateCommitmentStatus(data, "active");
  await generateCommitmentOccurrencesAction(data);
}
export async function resumeCommitment(data: FormData) {
  await resumeFinancialCommitment(data);
}
export async function completeFinancialCommitment(data: FormData) {
  const workspaceId = uuid.parse(data.get("workspace_id"));
  const commitmentId = uuid.parse(data.get("commitment_id"));
  const { supabase, user } = await requireWorkspace(workspaceId);
  const today = new Date().toISOString().slice(0, 10);
  const ended = await supabase.rpc("complete_financial_commitment", {
    target_workspace: workspaceId,
    target_commitment: commitmentId,
    target_date: today,
  });
  if (ended.error) {
    throwSupabaseError(
      ended.error,
      "completeFinancialCommitment",
      "Não foi possível encerrar a recorrência.",
    );
  }
  await recordCommitmentHistory({
    supabase,
    workspaceId,
    commitmentId,
    userId: user.id,
    eventType: "ended",
    summary: "Compromisso encerrado.",
    effectiveFrom: today,
  });
  invalidateCommitmentsCache(workspaceId);
}
export async function endCommitment(data: FormData) {
  await completeFinancialCommitment(data);
}
export async function archiveFinancialCommitment(data: FormData) {
  await updateCommitmentStatus(data, "archived");
}

export async function linkCommitmentToPerson(data: FormData) {
  const workspaceId = uuid.parse(data.get("workspace_id"));
  const commitmentId = uuid.parse(data.get("commitment_id"));
  const personId = uuid.parse(data.get("person_id"));
  const allocationType = z.enum(["full", "percentage", "fixed_amount"])
    .parse(data.get("allocation_type"));
  const allocationValue = amount.parse(data.get("allocation_value"));
  const { supabase, user } = await requireWorkspace(workspaceId);
  const [commitmentResult, existingResult] = await Promise.all([
    supabase.from("financial_commitments").select("expected_amount")
      .eq("workspace_id", workspaceId).eq("id", commitmentId).single(),
    supabase.from("commitment_people")
      .select("person_id,allocation_type,allocation_value,is_primary")
      .eq("workspace_id", workspaceId).eq("commitment_id", commitmentId)
      .neq("person_id", personId),
  ]);
  if (commitmentResult.error || existingResult.error) {
    throw new Error("Compromisso não encontrado.");
  }
  const allocations: CommitmentPersonAllocation[] = [
    ...(existingResult.data ?? []).map(item => ({
      personId: String(item.person_id),
      allocationType: item.allocation_type as CommitmentPersonAllocation["allocationType"],
      allocationValue: Number(item.allocation_value),
      isPrimary: Boolean(item.is_primary),
    })),
    { personId, allocationType, allocationValue, isPrimary: !existingResult.data?.length },
  ];
  const mixed = new Set(allocations.map(item => item.allocationType));
  const expectedCents = moneyToCents(commitmentResult.data.expected_amount);
  const percentageTotal = allocations.reduce((sum, item) =>
    sum + (item.allocationType === "percentage" ? item.allocationValue : 0), 0);
  const fixedTotalCents = allocations.reduce((sum, item) =>
    sum + (item.allocationType === "fixed_amount"
      ? Math.round(item.allocationValue * 100)
      : 0), 0);
  const invalid = mixed.size > 1 ||
    (allocationType === "full" && allocations.length !== 1) ||
    (allocationType === "percentage" && percentageTotal > 100.01) ||
    (allocationType === "fixed_amount" && expectedCents !== null &&
      fixedTotalCents > expectedCents);
  if (invalid) {
    throw new Error("A divisão entre pessoas não fecha com o valor do compromisso.");
  }
  const result = await supabase.from("commitment_people").upsert({
    workspace_id: workspaceId,
    created_by: user.id,
    commitment_id: commitmentId,
    person_id: personId,
    allocation_type: allocationType,
    allocation_value: allocationValue,
    is_primary: !existingResult.data?.length,
  }, { onConflict: "commitment_id,person_id" });
  if (result.error) {
    throwSupabaseError(
      result.error,
      "linkCommitmentToPerson",
      "Não foi possível salvar a divisão.",
    );
  }
  invalidateCommitmentsCache(workspaceId, { personId });
}

export async function unlinkCommitmentFromPerson(data: FormData) {
  const workspaceId = uuid.parse(data.get("workspace_id"));
  const commitmentId = uuid.parse(data.get("commitment_id"));
  const personId = uuid.parse(data.get("person_id"));
  const { supabase } = await requireWorkspace(workspaceId);
  const result = await supabase.from("commitment_people").delete()
    .eq("workspace_id", workspaceId).eq("commitment_id", commitmentId)
    .eq("person_id", personId);
  if (result.error) {
    throwSupabaseError(
      result.error,
      "unlinkCommitmentFromPerson",
      "Não foi possível remover a pessoa.",
    );
  }
  invalidateCommitmentsCache(workspaceId, { personId });
}

export async function generateCommitmentOccurrencesAction(data: FormData) {
  const workspaceId = uuid.parse(data.get("workspace_id"));
  const commitmentId = uuid.parse(data.get("commitment_id"));
  const { supabase, user } = await requireWorkspace(workspaceId);
  const result = await supabase.from("financial_commitments")
    .select(commitmentRowSelect).eq("id", commitmentId)
    .eq("workspace_id", workspaceId).single();
  if (result.error) {
    throwSupabaseError(
      result.error,
      "generateCommitmentOccurrences",
      "Compromisso não encontrado.",
    );
  }
  const commitment = mapCommitment(
    result.data as unknown as Parameters<typeof mapCommitment>[0],
  );
  await persistCommitmentOccurrences({
    supabase,
    userId: user.id,
    commitment,
  });
  invalidateCommitmentsCache(workspaceId);
}

export async function ensureRollingCommitmentOccurrences(workspaceId: string) {
  const parsedWorkspaceId = uuid.parse(workspaceId);
  const { supabase, user } = await requireWorkspace(parsedWorkspaceId);
  const result = await supabase.from("financial_commitments")
    .select(commitmentRowSelect)
    .eq("workspace_id", parsedWorkspaceId)
    .eq("status", "active")
    .eq("generates_future_projections", true)
    .is("archived_at", null);
  if (result.error) {
    throwSupabaseError(
      result.error,
      "ensureRollingCommitmentOccurrences.read",
      "Não foi possível atualizar as previsões recorrentes.",
    );
  }
  let generated = 0;
  let pruned = 0;
  for (const row of result.data ?? []) {
    const commitment = mapCommitment(
      row as unknown as Parameters<typeof mapCommitment>[0],
    );
    const persisted = await persistCommitmentOccurrences({
      supabase,
      userId: user.id,
      commitment,
    });
    generated += persisted.generated;
    pruned += persisted.pruned;
  }
  if (generated || pruned) invalidateCommitmentsCache(parsedWorkspaceId);
  return { generated, pruned };
}

export async function skipCommitmentOccurrence(data: FormData) {
  const workspaceId = uuid.parse(data.get("workspace_id"));
  const occurrenceId = uuid.parse(data.get("occurrence_id"));
  const { supabase, user } = await requireWorkspace(workspaceId);
  const occurrence = await supabase.from("financial_commitment_occurrences")
    .select(
      "id,commitment_id,status,linked_transaction_id,linked_card_movement_id,competence_month",
    )
    .eq("workspace_id", workspaceId)
    .eq("id", occurrenceId)
    .single();
  if (occurrence.error) throw new Error("Ocorrência não encontrada.");
  if (
    ["paid", "partially_paid"].includes(String(occurrence.data.status)) ||
    occurrence.data.linked_transaction_id ||
    occurrence.data.linked_card_movement_id
  ) {
    throw new Error("Uma ocorrência já paga não pode ser pulada.");
  }
  const skipped = await supabase.from("financial_commitment_occurrences")
    .update({
      status: "skipped",
      cancelled_at: new Date().toISOString(),
      manually_confirmed: true,
    })
    .eq("workspace_id", workspaceId)
    .eq("id", occurrenceId);
  if (skipped.error) {
    throwSupabaseError(
      skipped.error,
      "skipCommitmentOccurrence",
      "Não foi possível pular esta ocorrência.",
    );
  }
  await recordCommitmentHistory({
    supabase,
    workspaceId,
    commitmentId: String(occurrence.data.commitment_id),
    userId: user.id,
    eventType: "occurrence_skipped",
    summary: "Mês pulado.",
    effectiveFrom: String(occurrence.data.competence_month).slice(0, 10),
  });
  invalidateCommitmentsCache(workspaceId, {
    month: String(occurrence.data.competence_month).slice(0, 7),
  });
}

export async function skipOccurrence(data: FormData) {
  await skipCommitmentOccurrence(data);
}

export async function markCommitmentOccurrencePaid(data: FormData) {
  const workspaceId = uuid.parse(data.get("workspace_id"));
  const occurrenceId = uuid.parse(data.get("occurrence_id"));
  const { supabase, user } = await requireWorkspace(workspaceId);
  const occurrence = await supabase.from("financial_commitment_occurrences")
    .select("id,commitment_id,competence_month,expected_amount,status")
    .eq("workspace_id", workspaceId)
    .eq("id", occurrenceId)
    .single();
  if (occurrence.error) throw new Error("Ocorrência não encontrada.");
  if (["cancelled", "skipped", "disputed"].includes(occurrence.data.status)) {
    throw new Error("Esta ocorrência não pode ser marcada como paga.");
  }
  const paid = await supabase.from("financial_commitment_occurrences").update({
    status: "paid",
    actual_amount: occurrence.data.expected_amount,
    payment_date: new Date().toISOString().slice(0, 10),
    manually_confirmed: true,
    match_source: "manual_confirmation",
    match_confidence: 1,
  }).eq("workspace_id", workspaceId).eq("id", occurrenceId);
  if (paid.error) {
    throwSupabaseError(
      paid.error,
      "markCommitmentOccurrencePaid",
      "Não foi possível confirmar o pagamento.",
    );
  }
  await recordCommitmentHistory({
    supabase,
    workspaceId,
    commitmentId: String(occurrence.data.commitment_id),
    userId: user.id,
    eventType: "payment_linked",
    summary: "Pagamento confirmado manualmente.",
    effectiveFrom: new Date().toISOString().slice(0, 10),
  });
  await refreshCommitmentNextDueDate({
    supabase,
    workspaceId,
    commitmentId: String(occurrence.data.commitment_id),
  });
  invalidateCommitmentsCache(workspaceId, {
    month: String(occurrence.data.competence_month).slice(0, 7),
  });
}

export async function markOccurrencePaid(data: FormData) {
  await markCommitmentOccurrencePaid(data);
}

export async function updateCommitmentAmount(
  data: FormData,
): Promise<FinanceFormResult> {
  try {
    const parsed = z.object({
      workspace_id: uuid,
      commitment_id: uuid,
      occurrence_id: uuid,
      expected_amount: decimalAmount,
      amount_type: z.enum(["fixed", "estimated", "variable"]),
      scope: z.enum(["single_occurrence", "from_effective_date"]),
      reason: z.string().trim().max(240).nullable(),
    }).parse({
      workspace_id: data.get("workspace_id"),
      commitment_id: data.get("commitment_id"),
      occurrence_id: data.get("occurrence_id"),
      expected_amount: data.get("expected_amount"),
      amount_type: data.get("amount_type"),
      scope: data.get("scope"),
      reason: nullable(data.get("reason")),
    });
    const { supabase, user } = await requireWorkspace(parsed.workspace_id);
    const occurrence = await supabase.from("financial_commitment_occurrences")
      .select(
        "id,expected_due_date",
      )
      .eq("workspace_id", parsed.workspace_id)
      .eq("commitment_id", parsed.commitment_id)
      .eq("id", parsed.occurrence_id)
      .single();
    if (occurrence.error) throw new Error("Ocorrência não encontrada.");
    if (!occurrence.data.expected_due_date) {
      throw new Error("Esta ocorrência não possui uma data válida.");
    }
    const effectiveFrom = occurrence.data.expected_due_date;
    const revision = await supabase.rpc(
      "revise_financial_commitment_amount",
      {
        target_workspace: parsed.workspace_id,
        target_commitment: parsed.commitment_id,
        target_occurrence: parsed.occurrence_id,
        target_amount: parsed.expected_amount,
        target_amount_type: parsed.amount_type,
        target_scope: parsed.scope,
        target_reason: parsed.reason,
      },
    );
    if (revision.error) {
      throwSupabaseError(
        revision.error,
        "updateCommitmentAmount",
        "Não foi possível atualizar o valor da recorrência.",
      );
    }
    await recordCommitmentHistory({
      supabase,
      workspaceId: parsed.workspace_id,
      commitmentId: parsed.commitment_id,
      userId: user.id,
      eventType: "amount_changed",
      summary: parsed.scope === "single_occurrence"
        ? "Valor alterado somente neste mês."
        : "Valor alterado para os próximos meses.",
      effectiveFrom,
    });
    invalidateCommitmentsCache(parsed.workspace_id, {
      month: effectiveFrom.slice(0, 7),
    });
    return successfulFormResult("Valor atualizado sem alterar o histórico pago.");
  } catch (error) {
    return friendlyActionFailure(
      error,
      "Não foi possível atualizar o valor. Revise os dados e tente novamente.",
    );
  }
}

export async function updateFutureCommitmentValue(
  data: FormData,
): Promise<FinanceFormResult> {
  return updateCommitmentAmount(data);
}

export async function linkTransactionToOccurrence(
  data: FormData,
): Promise<FinanceFormResult> {
  try {
    const workspaceId = uuid.parse(data.get("workspace_id"));
    const occurrenceId = uuid.parse(data.get("occurrence_id"));
    const transactionId = uuid.parse(data.get("transaction_id"));
    const replaceExisting = data.get("replace_existing") === "true";
    const { supabase, user } = await requireWorkspace(workspaceId);
    const [occurrenceResult, transactionResult] = await Promise.all([
      supabase.from("financial_commitment_occurrences").select("*")
        .eq("id", occurrenceId).eq("workspace_id", workspaceId).single(),
      supabase.from("financial_transactions")
        .select("id,competence_date,workspace_id,owner_id,visibility")
        .eq("id", transactionId).single(),
    ]);
    if (occurrenceResult.error || transactionResult.error) {
      return failedFormResult(
        "A parcela ou a movimentação não foi encontrada.",
      );
    }
    const occurrence = mapOccurrence(
      occurrenceResult.data as unknown as Parameters<typeof mapOccurrence>[0],
    );
    const linked = await supabase.rpc(
      "link_financial_transaction_to_occurrence",
      {
        p_workspace_id: workspaceId,
        p_occurrence_id: occurrenceId,
        p_transaction_id: transactionId,
        p_replace_existing: replaceExisting,
      },
    );
    if (linked.error) {
      throwSupabaseError(
        linked.error,
        "linkTransactionToOccurrence",
        linked.error.code === "23505"
          ? "A parcela escolhida já possui outro pagamento."
          : "Não foi possível vincular o pagamento.",
      );
    }
    const result = (linked.data?.[0] ?? null) as {
      outcome?: string;
      previous_occurrence_id?: string | null;
      previous_commitment_id?: string | null;
      previous_commitment_title?: string | null;
    } | null;
    if (!result) {
      return failedFormResult("Não foi possível confirmar o vínculo.");
    }
    if (result.outcome === "conflict") {
      const currentTitle = result.previous_commitment_title?.trim() ||
        "outro compromisso";
      return failedFormResult(
        `Esta movimentação já paga “${currentTitle}”. Confirme abaixo para transferir o pagamento para a parcela escolhida.`,
        {
          replace_existing: [
            "Confirme a substituição do vínculo atual.",
          ],
        },
      );
    }
    if (result.outcome === "already_linked") {
      return successfulFormResult(
        "Esta movimentação já estava vinculada. O destino ficou memorizado para os próximos pagamentos.",
        occurrenceId,
      );
    }
    await recordCommitmentHistory({
      supabase,
      workspaceId,
      commitmentId: occurrence.commitmentId,
      userId: user.id,
      eventType: "payment_linked",
      summary: result.outcome === "replaced"
        ? "Pagamento transferido de outro compromisso."
        : "Pagamento vinculado.",
      effectiveFrom: transactionResult.data.competence_date,
    });
    if (result.outcome === "replaced" && result.previous_commitment_id) {
      await recordCommitmentHistory({
        supabase,
        workspaceId,
        commitmentId: result.previous_commitment_id,
        userId: user.id,
        eventType: "updated",
        summary: "Pagamento transferido para outro compromisso.",
        effectiveFrom: transactionResult.data.competence_date,
      });
      await refreshCommitmentNextDueDate({
        supabase,
        workspaceId,
        commitmentId: result.previous_commitment_id,
      });
    }
    await refreshCommitmentNextDueDate({
      supabase,
      workspaceId,
      commitmentId: occurrence.commitmentId,
    });
    invalidateCommitmentsCache(workspaceId, {
      month: occurrence.competenceMonth.slice(0, 7),
    });
    return successfulFormResult(
      result.outcome === "replaced"
        ? "Pagamento transferido para a parcela escolhida."
        : "Pagamento vinculado. O destino será reconhecido automaticamente nos próximos meses.",
      occurrenceId,
    );
  } catch (error) {
    return friendlyActionFailure(
      error,
      "Não foi possível vincular o pagamento. Tente novamente.",
    );
  }
}

export async function linkPaymentToCommitment(
  data: FormData,
): Promise<FinanceFormResult> {
  return linkTransactionToOccurrence(data);
}

export async function linkCardMovementToOccurrence(data: FormData) {
  const workspaceId = uuid.parse(data.get("workspace_id"));
  const occurrenceId = uuid.parse(data.get("occurrence_id"));
  const movementId = uuid.parse(data.get("movement_id"));
  const { supabase } = await requireWorkspace(workspaceId);
  const [occurrenceResult, movementResult] = await Promise.all([
    supabase.from("financial_commitment_occurrences").select("*")
      .eq("id", occurrenceId).eq("workspace_id", workspaceId).single(),
    supabase.from("card_purchases")
      .select("id,amount,amount_brl,purchase_date,invoice_id,card_invoices(status,payment_status,paid_at,due_date)")
      .eq("id", movementId).single(),
  ]);
  if (occurrenceResult.error || movementResult.error) {
    throw new Error("Ocorrência ou compra do cartão não encontrada.");
  }
  const amountCents = moneyToCents(
    movementResult.data.amount_brl ?? movementResult.data.amount,
  ) ?? 0;
  const occurrence = mapOccurrence(
    occurrenceResult.data as unknown as Parameters<typeof mapOccurrence>[0],
  );
  const invoiceRelation = movementResult.data.card_invoices as unknown as
    | {
        status: string;
        payment_status: string | null;
        paid_at: string | null;
        due_date: string;
      }
    | Array<{
        status: string;
        payment_status: string | null;
        paid_at: string | null;
        due_date: string;
      }>
    | null;
  const invoice = Array.isArray(invoiceRelation)
    ? invoiceRelation[0] ?? null
    : invoiceRelation;
  const invoicePaid = invoice?.status === "paid" ||
    invoice?.payment_status === "paid";
  const today = new Date().toISOString().slice(0, 10);
  const status = invoicePaid
    ? "paid"
    : occurrence.expectedDueDate && occurrence.expectedDueDate < today
      ? "overdue"
      : "pending";
  const updated = await supabase.from("financial_commitment_occurrences")
    .update({
      linked_card_movement_id: movementId,
      linked_invoice_id: movementResult.data.invoice_id,
      actual_amount: centsToMoney(amountCents),
      paid_amount: invoicePaid ? centsToMoney(amountCents) : 0,
      payment_date: invoicePaid
        ? invoice?.paid_at?.slice(0, 10) ?? invoice?.due_date ?? null
        : null,
      status,
      manually_confirmed: true,
      match_source: invoicePaid ? "card_invoice" : "card_purchase",
      match_confidence: 1,
    }).eq("id", occurrenceId).eq("workspace_id", workspaceId);
  if (updated.error) {
    throwSupabaseError(
      updated.error,
      "linkCardMovementToOccurrence",
      updated.error.code === "23505"
        ? "Esta compra já está vinculada a outro compromisso."
        : "Não foi possível vincular a compra.",
    );
  }
  invalidateCommitmentsCache(workspaceId, {
    month: occurrence.competenceMonth.slice(0, 7),
  });
}

export async function unlinkTransactionFromOccurrence(data: FormData) {
  const workspaceId = uuid.parse(data.get("workspace_id"));
  const occurrenceId = uuid.parse(data.get("occurrence_id"));
  const { supabase } = await requireWorkspace(workspaceId);
  const unlinked = await supabase.rpc(
    "unlink_financial_occurrence_payments",
    {
      p_workspace_id: workspaceId,
      p_occurrence_id: occurrenceId,
    },
  );
  if (unlinked.error) {
    throwSupabaseError(
      unlinked.error,
      "unlinkTransactionFromOccurrence",
      "Não foi possível remover o vínculo.",
    );
  }
  invalidateCommitmentsCache(workspaceId);
}

export async function updateCommitmentOccurrence(data: FormData) {
  const workspaceId = uuid.parse(data.get("workspace_id"));
  const occurrenceId = uuid.parse(data.get("occurrence_id"));
  const status = z.enum([
    "projected", "expected", "pending", "paid", "partially_paid",
    "overdue", "skipped", "cancelled", "disputed",
  ]).parse(data.get("status"));
  const actualAmount = amount.nullable().parse(
    nullable(data.get("actual_amount")),
  );
  const paymentDate = z.string().date().nullable().parse(
    nullable(data.get("payment_date")),
  );
  const notes = z.string().trim().max(1000).nullable().parse(
    nullable(data.get("notes")),
  );
  const { supabase } = await requireWorkspace(workspaceId);
  const result = await supabase.from("financial_commitment_occurrences")
    .update({
      status,
      actual_amount: actualAmount,
      payment_date: paymentDate,
      notes,
      manually_confirmed: true,
      cancelled_at: status === "cancelled" ? new Date().toISOString() : null,
    }).eq("workspace_id", workspaceId).eq("id", occurrenceId);
  if (result.error) {
    throwSupabaseError(
      result.error,
      "updateCommitmentOccurrence",
      "Não foi possível atualizar a ocorrência.",
    );
  }
  invalidateCommitmentsCache(workspaceId);
}

export async function updateOccurrenceStatusesAction(data: FormData) {
  const workspaceId = uuid.parse(data.get("workspace_id"));
  const { supabase } = await requireWorkspace(workspaceId);
  const result = await supabase.from("financial_commitment_occurrences")
    .select("*").eq("workspace_id", workspaceId)
    .in("status", ["projected", "expected", "pending", "overdue", "partially_paid"]);
  if (result.error) {
    throwSupabaseError(
      result.error,
      "updateOccurrenceStatuses.read",
      "Não foi possível verificar os vencimentos.",
    );
  }
  const mapped = (result.data ?? []).map(row => mapOccurrence(
    row as unknown as Parameters<typeof mapOccurrence>[0],
  ));
  const updated = updateOccurrenceStatuses(
    mapped,
    new Date().toISOString().slice(0, 10),
  ).filter((item, index) => item.status !== mapped[index].status);
  for (const occurrence of updated) {
    const statusResult = await supabase
      .from("financial_commitment_occurrences")
      .update({ status: occurrence.status })
      .eq("workspace_id", workspaceId).eq("id", occurrence.id);
    if (statusResult.error) {
      throwSupabaseError(
        statusResult.error,
        "updateOccurrenceStatuses.write",
        "Não foi possível atualizar todos os vencimentos.",
      );
    }
  }
  invalidateCommitmentsCache(workspaceId);
  return updated.length;
}

export async function matchCommitmentsForTransaction(input: {
  workspaceId: string;
  transactionId: string;
}) {
  const { supabase } = await requireWorkspace(uuid.parse(input.workspaceId));
  const transaction = await supabase.from("financial_transactions").select(
    "id,description,merchant,amount,competence_date,account_id,credit_card_id",
  ).eq("id", uuid.parse(input.transactionId)).single();
  if (transaction.error) return [];
  const occurrences = await supabase.from("financial_commitment_occurrences")
    .select(
      "*,financial_commitments!inner(id,workspace_id,title,description,commitment_type,recurrence_frequency,recurrence_interval,amount_type,expected_amount,minimum_expected_amount,maximum_expected_amount,currency_code,category_id,account_id,card_id,payment_method,due_day,due_date,start_date,end_date,next_due_date,status,auto_match_enabled,merchant_match_pattern,description_match_pattern,expected_day_tolerance,expected_amount_tolerance,source,source_record_id,is_payroll_deduction,generates_future_projections,last_generated_until)",
    ).eq("workspace_id", input.workspaceId)
    .in("status", ["projected", "expected", "pending", "overdue"])
    .is("linked_transaction_id", null);
  return (occurrences.data ?? []).map(row => {
    const commitmentRow = Array.isArray(row.financial_commitments)
      ? row.financial_commitments[0]
      : row.financial_commitments;
    return scoreCommitmentMatch({
      occurrence: mapOccurrence(
        row as unknown as Parameters<typeof mapOccurrence>[0],
      ),
      commitment: mapCommitment(
        commitmentRow as unknown as Parameters<typeof mapCommitment>[0],
      ),
      transaction: {
        id: transaction.data.id,
        description: transaction.data.description,
        merchant: transaction.data.merchant,
        amountCents: moneyToCents(transaction.data.amount) ?? 0,
        date: transaction.data.competence_date,
        accountId: transaction.data.account_id,
        cardId: transaction.data.credit_card_id,
      },
    });
  }).sort((a, b) => b.score - a.score);
}

export async function confirmCommitmentMatch(data: FormData) {
  const workspaceId = uuid.parse(data.get("workspace_id"));
  const transactionId = uuid.parse(data.get("transaction_id"));
  const occurrenceId = uuid.parse(data.get("occurrence_id"));
  const commitmentId = uuid.parse(data.get("commitment_id"));
  const link = new FormData();
  link.set("workspace_id", workspaceId);
  link.set("transaction_id", transactionId);
  link.set("occurrence_id", occurrenceId);
  const linkResult = await linkTransactionToOccurrence(link);
  if (!linkResult.ok) throw new Error(linkResult.message);
  const { supabase, user } = await requireWorkspace(workspaceId);
  const fingerprint = `transaction:${transactionId}:commitment:${commitmentId}`;
  const decision = await supabase.from("commitment_match_decisions").upsert({
    workspace_id: workspaceId,
    created_by: user.id,
    commitment_id: commitmentId,
    transaction_id: transactionId,
    fingerprint,
    decision: "confirmed",
  }, { onConflict: "workspace_id,fingerprint" });
  if (decision.error) {
    throwSupabaseError(
      decision.error,
      "confirmCommitmentMatch",
      "O pagamento foi vinculado, mas a decisão não pôde ser registrada.",
    );
  }
  invalidateCommitmentsCache(workspaceId);
}

export async function rejectCommitmentMatch(data: FormData) {
  const workspaceId = uuid.parse(data.get("workspace_id"));
  const transactionId = uuid.parse(data.get("transaction_id"));
  const commitmentId = uuid.parse(data.get("commitment_id"));
  const { supabase, user } = await requireWorkspace(workspaceId);
  const fingerprint = `transaction:${transactionId}:commitment:${commitmentId}`;
  const decision = await supabase.from("commitment_match_decisions").upsert({
    workspace_id: workspaceId,
    created_by: user.id,
    commitment_id: commitmentId,
    transaction_id: transactionId,
    fingerprint,
    decision: "rejected",
  }, { onConflict: "workspace_id,fingerprint" });
  if (decision.error) {
    throwSupabaseError(
      decision.error,
      "rejectCommitmentMatch",
      "Não foi possível rejeitar a sugestão.",
    );
  }
  invalidateCommitmentsCache(workspaceId);
}

export async function rejectRecurringSuggestion(data: FormData) {
  const workspaceId = uuid.parse(data.get("workspace_id"));
  const fingerprint = z.string().trim().min(1).max(300)
    .parse(data.get("fingerprint"));
  const { supabase, user } = await requireWorkspace(workspaceId);
  const decision = await supabase.from("commitment_match_decisions").upsert({
    workspace_id: workspaceId,
    created_by: user.id,
    fingerprint,
    decision: "rejected",
  }, { onConflict: "workspace_id,fingerprint" });
  if (decision.error) {
    throwSupabaseError(
      decision.error,
      "rejectRecurringSuggestion",
      "Não foi possível ocultar a sugestão.",
    );
  }
  invalidateCommitmentsCache(workspaceId);
}

export async function linkTransactionToPeople(data: FormData) {
  const workspaceId = uuid.parse(data.get("workspace_id"));
  const transactionId = uuid.parse(data.get("transaction_id"));
  const personId = uuid.parse(data.get("person_id"));
  const allocationType = z.enum(["full", "percentage", "fixed_amount"])
    .parse(data.get("allocation_type"));
  const allocationValue = amount.parse(data.get("allocation_value"));
  const { supabase, user } = await requireWorkspace(workspaceId);
  const [transaction, existing] = await Promise.all([
    supabase.from("financial_transactions")
      .select("amount").eq("id", transactionId).single(),
    supabase.from("transaction_people")
      .select("person_id,allocation_type,allocation_value")
      .eq("transaction_id", transactionId).neq("person_id", personId),
  ]);
  if (transaction.error || existing.error) {
    throw new Error("Movimentação não encontrada.");
  }
  const allocations = [
    ...(existing.data ?? []).map(item => ({
      allocationType: item.allocation_type,
      allocationValue: Number(item.allocation_value),
    })),
    { allocationType, allocationValue },
  ];
  const modes = new Set(allocations.map(item => item.allocationType));
  const percentageTotal = allocations.reduce((sum, item) =>
    sum + (item.allocationType === "percentage" ? item.allocationValue : 0), 0);
  const fixedTotal = allocations.reduce((sum, item) =>
    sum + (item.allocationType === "fixed_amount"
      ? Math.round(item.allocationValue * 100)
      : 0), 0);
  const movementAmount = Math.abs(moneyToCents(transaction.data.amount) ?? 0);
  if (
    modes.size > 1 ||
    (allocationType === "full" && allocations.length !== 1) ||
    percentageTotal > 100.01 ||
    fixedTotal > movementAmount
  ) throw new Error("A divisão informada é inválida.");
  const saved = await supabase.from("transaction_people").upsert({
    workspace_id: workspaceId,
    created_by: user.id,
    transaction_id: transactionId,
    person_id: personId,
    allocation_type: allocationType,
    allocation_value: allocationValue,
    source: "manual",
    manually_confirmed: true,
  }, { onConflict: "transaction_id,person_id" });
  if (saved.error) throw new Error("Não foi possível associar a pessoa.");
  invalidateCommitmentsCache(workspaceId, { personId });
}

export async function unlinkTransactionFromPerson(data: FormData) {
  const workspaceId = uuid.parse(data.get("workspace_id"));
  const transactionId = uuid.parse(data.get("transaction_id"));
  const personId = uuid.parse(data.get("person_id"));
  const { supabase } = await requireWorkspace(workspaceId);
  const result = await supabase.from("transaction_people").delete()
    .eq("workspace_id", workspaceId).eq("transaction_id", transactionId)
    .eq("person_id", personId);
  if (result.error) {
    throwSupabaseError(
      result.error,
      "unlinkTransactionFromPerson",
      "Não foi possível remover a pessoa da movimentação.",
    );
  }
  invalidateCommitmentsCache(workspaceId, { personId });
}

async function transformTransactionIntoRecurringCommitmentInternal(
  data: FormData,
) {
  const workspaceId = uuid.parse(data.get("workspace_id"));
  const transactionId = uuid.parse(data.get("transaction_id"));
  const { supabase } = await requireWorkspace(workspaceId);
  const transaction = await supabase.from("financial_transactions").select(
    "id,description,merchant,amount,competence_date,account_id,category_id,bank_direction",
  ).eq("id", transactionId).single();
  if (transaction.error) throw new Error("Movimentação não encontrada.");
  const adapted = new FormData();
  adapted.set("workspace_id", workspaceId);
  adapted.set("title", String(data.get("title") ||
    transaction.data.merchant || transaction.data.description));
  adapted.set("description", transaction.data.description);
  adapted.set("commitment_type", "recurring");
  adapted.set("recurrence_frequency", String(
    data.get("recurrence_frequency") || "monthly",
  ));
  adapted.set("amount_type", "estimated");
  adapted.set("expected_amount", String(Math.abs(Number(transaction.data.amount))));
  adapted.set("category_id", transaction.data.category_id ?? "");
  adapted.set("account_id", transaction.data.account_id ?? "");
  adapted.set("card_id", "");
  adapted.set("payment_method", "bank_debit");
  adapted.set("due_day", transaction.data.competence_date.slice(8, 10));
  adapted.set("start_date", transaction.data.competence_date);
  adapted.set("auto_match_enabled", "false");
  adapted.set("merchant_match_pattern", transaction.data.merchant ?? "");
  adapted.set("person_id", String(data.get("person_id") ?? ""));
  adapted.set("allocation_type", "full");
  adapted.set("allocation_value", "100");
  adapted.set(
    "cash_flow_direction",
    transaction.data.bank_direction === "inflow" ? "income" : "expense",
  );
  adapted.set("generates_future_projections", "true");
  adapted.set("projection_confirmation", "true");
  const commitmentId = await createFinancialCommitment(adapted);
  const sourceUpdate = await supabase.from("financial_commitments").update({
    source: "movement",
    source_record_id: transactionId,
  }).eq("id", commitmentId).eq("workspace_id", workspaceId);
  if (sourceUpdate.error) {
    await supabase.from("financial_commitments").delete()
      .eq("workspace_id", workspaceId)
      .eq("id", commitmentId);
    throwSupabaseError(
      sourceUpdate.error,
      "transformTransactionIntoRecurringCommitment.source",
      "A recorrência foi criada, mas a origem não pôde ser registrada.",
    );
  }
  const occurrence = await supabase.from("financial_commitment_occurrences")
    .select("id").eq("workspace_id", workspaceId)
    .eq("commitment_id", commitmentId)
    .eq(
      "competence_month",
      `${transaction.data.competence_date.slice(0, 7)}-01`,
    ).limit(1).single();
  if (occurrence.error || !occurrence.data) {
    await supabase.from("financial_commitments").delete()
      .eq("workspace_id", workspaceId)
      .eq("id", commitmentId);
    throw new Error(
      "A recorrência não gerou a ocorrência do pagamento original.",
    );
  }
  const link = new FormData();
  link.set("workspace_id", workspaceId);
  link.set("occurrence_id", occurrence.data.id);
  link.set("transaction_id", transactionId);
  try {
    const linkResult = await linkTransactionToOccurrence(link);
    if (!linkResult.ok) throw new Error(linkResult.message);
  } catch (error) {
    await supabase.from("financial_commitments").delete()
      .eq("workspace_id", workspaceId)
      .eq("id", commitmentId);
    throw error;
  }
  invalidateCommitmentsCache(workspaceId);
  return commitmentId;
}

export async function transformTransactionIntoRecurringCommitment(
  data: FormData,
): Promise<FinanceFormResult> {
  try {
    const id = await transformTransactionIntoRecurringCommitmentInternal(data);
    return successfulFormResult(
      "Recorrência criada e vinculada à movimentação.",
      id,
    );
  } catch (error) {
    return friendlyActionFailure(
      error,
      "Não foi possível criar a recorrência. Revise os dados e tente novamente.",
    );
  }
}

export async function createCommitmentFromMovement(
  data: FormData,
): Promise<FinanceFormResult> {
  return transformTransactionIntoRecurringCommitment(data);
}
