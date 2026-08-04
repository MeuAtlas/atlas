"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireFinanceAccess } from "./access";
import {
  extractCounterpartyFingerprint,
  normalizeFinancialName,
} from "./financial-counterparty";

const uuid = z.string().uuid();
const schema = z.object({
  workspaceId: uuid,
  transactionId: uuid,
  name: z.string().trim().min(1).max(160),
  categoryId: z.union([uuid, z.literal("")]).transform(value => value || null),
  referenceDailyAmount: z.string().trim().transform(value => {
    if (!value) return null;
    const number = Number(value.replace(/\./g, "").replace(",", "."));
    return Number.isFinite(number) && number > 0 ? number : Number.NaN;
  }).refine(value => value === null || Number.isFinite(value), "Valor de referência inválido."),
  planningEnabled: z.boolean(),
  applyToHistory: z.boolean(),
});

type RuleIdentity = {
  matchType: "provider_counterparty" | "pix_key" | "tax_number" |
    "bank_account" | "normalized_name";
  matchHash: string;
  displayName: string | null;
  maskedIdentifier: string | null;
};

const sha256 = (value: string) =>
  createHash("sha256").update(value).digest("hex");

function ruleIdentity(fingerprint: ReturnType<typeof extractCounterpartyFingerprint>): RuleIdentity {
  if (fingerprint.taxNumberHash) return {
    matchType: "tax_number",
    matchHash: sha256(fingerprint.taxNumberHash),
    displayName: fingerprint.normalizedCounterpartyName,
    maskedIdentifier: fingerprint.maskedTaxNumber,
  };
  if (fingerprint.providerCounterpartyId) return {
    matchType: "provider_counterparty",
    matchHash: sha256(fingerprint.providerCounterpartyId),
    displayName: fingerprint.normalizedCounterpartyName,
    maskedIdentifier: null,
  };
  if (fingerprint.pixKeyHash) return {
    matchType: "pix_key",
    matchHash: sha256(fingerprint.pixKeyHash),
    displayName: fingerprint.normalizedCounterpartyName,
    maskedIdentifier: fingerprint.maskedPixKey,
  };
  if (fingerprint.bankCode && fingerprint.accountMasked) return {
    matchType: "bank_account",
    matchHash: sha256(`${fingerprint.bankCode}:${fingerprint.accountMasked}`),
    displayName: fingerprint.normalizedCounterpartyName,
    maskedIdentifier: fingerprint.accountMasked,
  };
  if (fingerprint.normalizedCounterpartyName && fingerprint.confidence >= 0.86) return {
    matchType: "normalized_name",
    matchHash: sha256(fingerprint.normalizedCounterpartyName),
    displayName: fingerprint.normalizedCounterpartyName,
    maskedIdentifier: null,
  };
  throw new Error("Este PIX não possui um destinatário estável para criar a regra automática.");
}

function rowFingerprint(row: {
  description: string;
  merchant: string | null;
  provider_metadata: unknown;
  source: string | null;
}) {
  return extractCounterpartyFingerprint({
    description: row.description,
    merchant: row.merchant,
    providerMetadata: row.provider_metadata,
    provider: row.source,
    direction: "outflow",
  });
}

function sameRule(identity: RuleIdentity, fingerprint: ReturnType<typeof extractCounterpartyFingerprint>) {
  if (identity.matchType === "tax_number") return fingerprint.taxNumberHash
    ? sha256(fingerprint.taxNumberHash) === identity.matchHash : false;
  if (identity.matchType === "provider_counterparty") return fingerprint.providerCounterpartyId
    ? sha256(fingerprint.providerCounterpartyId) === identity.matchHash : false;
  if (identity.matchType === "pix_key") return fingerprint.pixKeyHash
    ? sha256(fingerprint.pixKeyHash) === identity.matchHash : false;
  if (identity.matchType === "bank_account") return fingerprint.bankCode && fingerprint.accountMasked
    ? sha256(`${fingerprint.bankCode}:${fingerprint.accountMasked}`) === identity.matchHash : false;
  return fingerprint.normalizedCounterpartyName
    ? sha256(fingerprint.normalizedCounterpartyName) === identity.matchHash : false;
}

function refreshEstablishmentViews() {
  revalidatePath("/financeiro");
  revalidatePath("/financeiro/movimentacoes");
  revalidatePath("/financeiro/relatorios");
  revalidatePath("/financeiro/relatorios/[ano]/[mes]", "page");
}

export async function createExpenseEstablishmentAction(data: FormData) {
  try {
    const parsed = schema.parse({
      workspaceId: data.get("workspace_id"),
      transactionId: data.get("transaction_id"),
      name: data.get("name"),
      categoryId: String(data.get("category_id") ?? ""),
      referenceDailyAmount: String(data.get("reference_daily_amount") ?? ""),
      planningEnabled: data.get("planning_enabled") === "on",
      applyToHistory: data.get("apply_to_history") !== "false",
    });
    const { supabase, user } = await requireFinanceAccess();
    const transaction = await supabase.from("financial_transactions").select(
      "id,workspace_id,owner_id,description,merchant,provider_metadata,source,bank_direction,financial_nature,operation_type,status,category_id",
    ).eq("id", parsed.transactionId).maybeSingle();
    if (transaction.error || !transaction.data ||
      !(transaction.data.workspace_id === parsed.workspaceId ||
        (!transaction.data.workspace_id && transaction.data.owner_id === user.id))) {
      throw new Error("Movimentação não encontrada.");
    }
    const isPix = String(transaction.data.financial_nature ?? "") === "pix_sent" ||
      /PIX/i.test(String(transaction.data.operation_type ?? "")) ||
      /\bPIX\b/i.test(String(transaction.data.description ?? ""));
    if (transaction.data.bank_direction !== "outflow" || !isPix) {
      throw new Error("Selecione um PIX de saída para cadastrar o estabelecimento.");
    }
    const fingerprint = rowFingerprint({
      description: String(transaction.data.description),
      merchant: transaction.data.merchant ? String(transaction.data.merchant) : null,
      provider_metadata: transaction.data.provider_metadata,
      source: transaction.data.source ? String(transaction.data.source) : null,
    });
    const identity = ruleIdentity(fingerprint);
    const existingRule = await supabase.from("expense_establishment_rules")
      .select("id,establishment_id,expense_establishments(name,normalized_name)")
      .eq("workspace_id", parsed.workspaceId)
      .eq("match_type", identity.matchType)
      .eq("match_hash", identity.matchHash)
      .eq("is_active", true).maybeSingle();
    if (existingRule.error) throw new Error("Não foi possível verificar o destinatário.");
    if (existingRule.data) {
      const existing = Array.isArray(existingRule.data.expense_establishments)
        ? existingRule.data.expense_establishments[0]
        : existingRule.data.expense_establishments;
      if (existing?.normalized_name === normalizeFinancialName(parsed.name)) {
        const restored = await supabase.from("expense_establishment_transactions").upsert({
          workspace_id: parsed.workspaceId,
          establishment_id: existingRule.data.establishment_id,
          transaction_id: parsed.transactionId,
          rule_id: existingRule.data.id,
          association_source: "manual",
          is_active: true,
          created_by: user.id,
          unlinked_at: null,
        }, { onConflict: "transaction_id" });
        if (restored.error) throw new Error("Não foi possível restaurar o vínculo.");
        refreshEstablishmentViews();
        return { ok: true as const, message: `Movimentação associada novamente a ${existing.name}.` };
      }
      throw new Error(`Este destinatário já está associado a ${existing?.name ?? "outro estabelecimento"}.`);
    }
    const normalizedName = normalizeFinancialName(parsed.name);
    let establishment = await supabase.from("expense_establishments")
      .select("id").eq("workspace_id", parsed.workspaceId)
      .eq("normalized_name", normalizedName).maybeSingle();
    if (establishment.error) throw new Error("Não foi possível verificar o estabelecimento.");
    if (!establishment.data) {
      establishment = await supabase.from("expense_establishments").insert({
        workspace_id: parsed.workspaceId,
        created_by: user.id,
        name: parsed.name,
        normalized_name: normalizedName,
        category_id: parsed.categoryId,
        reference_daily_amount: parsed.referenceDailyAmount,
        planning_enabled: parsed.planningEnabled,
      }).select("id").single();
    }
    if (establishment.error || !establishment.data) {
      throw new Error("Não foi possível criar o estabelecimento.");
    }
    const rule = await supabase.from("expense_establishment_rules").insert({
      workspace_id: parsed.workspaceId,
      establishment_id: establishment.data.id,
      created_by: user.id,
      provider: transaction.data.source,
      match_type: identity.matchType,
      match_hash: identity.matchHash,
      display_name: identity.displayName,
      masked_identifier: identity.maskedIdentifier,
      apply_to_history: parsed.applyToHistory,
    }).select("id").single();
    if (rule.error || !rule.data) throw new Error("Não foi possível criar a regra automática.");

    let matchedIds = [parsed.transactionId];
    if (parsed.applyToHistory) {
      const candidates = await supabase.from("financial_transactions").select(
        "id,description,merchant,provider_metadata,source,bank_direction,status",
      ).eq("owner_id", user.id).eq("bank_direction", "outflow")
        .or(`workspace_id.eq.${parsed.workspaceId},workspace_id.is.null`)
        .not("status", "in", '("cancelled","disputed")').limit(3000);
      if (!candidates.error) {
        matchedIds = (candidates.data ?? []).filter(row => sameRule(
          identity,
          rowFingerprint({
            description: String(row.description ?? ""),
            merchant: row.merchant ? String(row.merchant) : null,
            provider_metadata: row.provider_metadata,
            source: row.source ? String(row.source) : null,
          }),
        )).map(row => String(row.id));
      }
    }
    const existingLinks = await supabase.from("expense_establishment_transactions")
      .select("transaction_id").in("transaction_id", matchedIds);
    const alreadyLinked = new Set((existingLinks.data ?? []).map(row => String(row.transaction_id)));
    const links = matchedIds.filter(id => !alreadyLinked.has(id)).map(id => ({
      workspace_id: parsed.workspaceId,
      establishment_id: establishment.data!.id,
      transaction_id: id,
      rule_id: rule.data.id,
      association_source: id === parsed.transactionId ? "manual" : "historical_backfill",
      created_by: user.id,
    }));
    if (links.length) {
      const linked = await supabase.from("expense_establishment_transactions").insert(links);
      if (linked.error) throw new Error("O estabelecimento foi criado, mas o histórico não pôde ser associado.");
    }
    if (parsed.categoryId && matchedIds.length) {
      await supabase.from("financial_transactions").update({ category_id: parsed.categoryId })
        .in("id", matchedIds).is("category_id", null).eq("manually_confirmed", false);
    }
    refreshEstablishmentViews();
    const historicalCount = Math.max(0, links.length - 1);
    return {
      ok: true as const,
      message: historicalCount
        ? `Pousada associada. ${historicalCount} pagamento(s) anterior(es) também foram encontrados.`
        : "Estabelecimento associado. Os próximos PIX serão reconhecidos automaticamente.",
    };
  } catch (error) {
    return {
      ok: false as const,
      message: error instanceof Error ? error.message : "Não foi possível associar o estabelecimento.",
    };
  }
}

export async function unlinkExpenseEstablishmentAction(data: FormData) {
  try {
    const workspaceId = uuid.parse(data.get("workspace_id"));
    const transactionId = uuid.parse(data.get("transaction_id"));
    const { supabase } = await requireFinanceAccess();
    const result = await supabase.from("expense_establishment_transactions").update({
      is_active: false,
      unlinked_at: new Date().toISOString(),
    }).eq("workspace_id", workspaceId).eq("transaction_id", transactionId);
    if (result.error) throw new Error("Não foi possível remover o vínculo.");
    refreshEstablishmentViews();
    return { ok: true as const, message: "Estabelecimento removido desta movimentação." };
  } catch (error) {
    return {
      ok: false as const,
      message: error instanceof Error ? error.message : "Não foi possível remover o vínculo.",
    };
  }
}
