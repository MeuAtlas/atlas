"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireFinanceAccess } from "./access";
import { extractCounterpartyFingerprint, normalizeFinancialName } from "./financial-counterparty";

const uuid = z.string().uuid();
const schema = z.object({
  workspaceId: uuid,
  sourceKind: z.enum(["transaction", "card_purchase", "invoice_entry"]),
  sourceId: uuid,
  name: z.string().trim().min(1).max(160),
  categoryId: z.union([uuid, z.literal("")]).transform(value => value || null),
  planningEnabled: z.boolean(),
  applyToHistory: z.boolean(),
});

type RuleIdentity = {
  matchType: "provider_counterparty" | "pix_key" | "tax_number" | "bank_account" | "normalized_name";
  matchHash: string;
  displayName: string | null;
  maskedIdentifier: string | null;
};

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

function ruleIdentity(fingerprint: ReturnType<typeof extractCounterpartyFingerprint>): RuleIdentity {
  if (fingerprint.taxNumberHash) return { matchType: "tax_number", matchHash: sha256(fingerprint.taxNumberHash), displayName: fingerprint.normalizedCounterpartyName, maskedIdentifier: fingerprint.maskedTaxNumber };
  if (fingerprint.providerCounterpartyId) return { matchType: "provider_counterparty", matchHash: sha256(fingerprint.providerCounterpartyId), displayName: fingerprint.normalizedCounterpartyName, maskedIdentifier: null };
  if (fingerprint.pixKeyHash) return { matchType: "pix_key", matchHash: sha256(fingerprint.pixKeyHash), displayName: fingerprint.normalizedCounterpartyName, maskedIdentifier: fingerprint.maskedPixKey };
  if (fingerprint.bankCode && fingerprint.accountMasked) return { matchType: "bank_account", matchHash: sha256(`${fingerprint.bankCode}:${fingerprint.accountMasked}`), displayName: fingerprint.normalizedCounterpartyName, maskedIdentifier: fingerprint.accountMasked };
  if (fingerprint.normalizedCounterpartyName && fingerprint.confidence >= 0.86) return { matchType: "normalized_name", matchHash: sha256(fingerprint.normalizedCounterpartyName), displayName: fingerprint.normalizedCounterpartyName, maskedIdentifier: null };
  throw new Error("Esta saida nao possui um destinatario estavel para criar uma regra automatica.");
}

function rowFingerprint(row: { description: string; merchant: string | null; provider_metadata: unknown; source: string | null }) {
  return extractCounterpartyFingerprint({ description: row.description, merchant: row.merchant, providerMetadata: row.provider_metadata, provider: row.source, direction: "outflow" });
}

function sameRule(identity: RuleIdentity, fingerprint: ReturnType<typeof extractCounterpartyFingerprint>) {
  if (identity.matchType === "tax_number") return fingerprint.taxNumberHash ? sha256(fingerprint.taxNumberHash) === identity.matchHash : false;
  if (identity.matchType === "provider_counterparty") return fingerprint.providerCounterpartyId ? sha256(fingerprint.providerCounterpartyId) === identity.matchHash : false;
  if (identity.matchType === "pix_key") return fingerprint.pixKeyHash ? sha256(fingerprint.pixKeyHash) === identity.matchHash : false;
  if (identity.matchType === "bank_account") return fingerprint.bankCode && fingerprint.accountMasked ? sha256(`${fingerprint.bankCode}:${fingerprint.accountMasked}`) === identity.matchHash : false;
  return fingerprint.normalizedCounterpartyName ? sha256(fingerprint.normalizedCounterpartyName) === identity.matchHash : false;
}

function refreshEstablishmentViews() {
  revalidatePath("/financeiro");
  revalidatePath("/financeiro/movimentacoes");
  revalidatePath("/financeiro/relatorios");
  revalidatePath("/financeiro/relatorios/[ano]/[mes]", "page");
}

async function findOrCreateEstablishment(
  supabase: Awaited<ReturnType<typeof requireFinanceAccess>>["supabase"],
  userId: string,
  parsed: z.infer<typeof schema>,
) {
  const normalizedName = normalizeFinancialName(parsed.name);
  let establishment = await supabase.from("expense_establishments").select("id,name")
    .eq("workspace_id", parsed.workspaceId).eq("normalized_name", normalizedName).maybeSingle();
  if (establishment.error) throw new Error(`Nao foi possivel verificar o estabelecimento: ${establishment.error.message}`);
  if (!establishment.data) {
    establishment = await supabase.from("expense_establishments").insert({
      workspace_id: parsed.workspaceId, created_by: userId, name: parsed.name,
      normalized_name: normalizedName, category_id: parsed.categoryId,
      planning_enabled: parsed.planningEnabled,
    }).select("id,name").single();
  }
  if (establishment.error || !establishment.data) throw new Error(
    `Nao foi possivel criar o estabelecimento${establishment.error ? `: ${establishment.error.message}` : "."}`,
  );
  return establishment.data;
}

export async function createExpenseEstablishmentAction(data: FormData) {
  try {
    const parsed = schema.parse({
      workspaceId: data.get("workspace_id"),
      sourceKind: data.get("source_kind") === "invoice_entry"
        ? "invoice_entry"
        : data.get("source_kind") === "card_purchase" ? "card_purchase" : "transaction",
      sourceId: data.get("source_id") ?? data.get("transaction_id"),
      name: data.get("name"), categoryId: String(data.get("category_id") ?? ""),
      planningEnabled: data.get("planning_enabled") === "on", applyToHistory: data.get("apply_to_history") !== "false",
    });
    const { supabase, user } = await requireFinanceAccess();

    if (parsed.sourceKind === "card_purchase" || parsed.sourceKind === "invoice_entry") {
      const source = parsed.sourceKind === "card_purchase"
        ? await supabase.from("card_purchases").select("id,workspace_id,owner_id,transaction_role,status").eq("id", parsed.sourceId).maybeSingle()
        : await supabase.from("invoice_entries").select("id,workspace_id,owner_id,entry_type,review_status,merchant_normalized").eq("id", parsed.sourceId).maybeSingle();
      if (source.error || !source.data || !(source.data.workspace_id === parsed.workspaceId || (!source.data.workspace_id && source.data.owner_id === user.id))) throw new Error("Compra no cartao nao encontrada.");
      const isPurchase = parsed.sourceKind === "card_purchase"
        ? "transaction_role" in source.data && source.data.transaction_role === "consumption" && !["cancelled", "disputed"].includes(String(source.data.status ?? ""))
        : "entry_type" in source.data && ["purchase", "installment_purchase"].includes(String(source.data.entry_type));
      if (!isPurchase) throw new Error("Selecione uma compra valida do cartao.");
      const establishment = await findOrCreateEstablishment(supabase, user.id, parsed);
      const existing = await supabase.from("expense_establishment_transactions").select("establishment_id")
        .eq("workspace_id", parsed.workspaceId).eq(parsed.sourceKind === "card_purchase" ? "card_purchase_id" : "invoice_entry_id", parsed.sourceId).maybeSingle();
      if (existing.error) throw new Error("Nao foi possivel verificar a compra selecionada.");
      if (existing.data && existing.data.establishment_id !== establishment.id) throw new Error("Esta compra ja esta associada a outro estabelecimento.");
      const link = existing.data
        ? await supabase.from("expense_establishment_transactions").update({ is_active: true, unlinked_at: null, created_by: user.id }).eq("workspace_id", parsed.workspaceId).eq(parsed.sourceKind === "card_purchase" ? "card_purchase_id" : "invoice_entry_id", parsed.sourceId)
        : await supabase.from("expense_establishment_transactions").insert({ workspace_id: parsed.workspaceId, establishment_id: establishment.id, ...(parsed.sourceKind === "card_purchase" ? { card_purchase_id: parsed.sourceId } : { invoice_entry_id: parsed.sourceId }), association_source: "manual", is_active: true, created_by: user.id });
      if (link.error) throw new Error("Nao foi possivel associar a compra ao estabelecimento.");
      if (parsed.sourceKind === "invoice_entry" && "merchant_normalized" in source.data && source.data.merchant_normalized) {
        const candidates = await supabase.from("invoice_entries").select("id")
          .eq("workspace_id", parsed.workspaceId)
          .eq("merchant_normalized", source.data.merchant_normalized)
          .in("entry_type", ["purchase", "installment_purchase"]);
        if (!candidates.error) {
          const candidateIds = (candidates.data ?? []).map(item => String(item.id));
          const linkedEntries = candidateIds.length
            ? await supabase.from("expense_establishment_transactions").select("invoice_entry_id")
              .eq("workspace_id", parsed.workspaceId).in("invoice_entry_id", candidateIds)
            : { data: [], error: null };
          if (!linkedEntries.error) {
            const linkedIds = new Set((linkedEntries.data ?? []).map(item => String(item.invoice_entry_id)));
            const historicalLinks = candidateIds.filter(id => !linkedIds.has(id)).map(id => ({
              workspace_id: parsed.workspaceId,
              establishment_id: establishment.id,
              invoice_entry_id: id,
              association_source: "historical_backfill" as const,
              is_active: true,
              created_by: user.id,
            }));
            if (historicalLinks.length) {
              const historical = await supabase.from("expense_establishment_transactions").insert(historicalLinks);
              if (historical.error) throw new Error("A compra foi associada, mas o historico do cartao nao pode ser vinculado.");
            }
          }
        }
      }
      refreshEstablishmentViews();
      return { ok: true as const, message: "Compra do cartao associada ao estabelecimento." };
    }

    const transaction = await supabase.from("financial_transactions").select("id,workspace_id,owner_id,description,merchant,provider_metadata,source,bank_direction,status,category_id")
      .eq("id", parsed.sourceId).maybeSingle();
    if (transaction.error || !transaction.data || !(transaction.data.workspace_id === parsed.workspaceId || (!transaction.data.workspace_id && transaction.data.owner_id === user.id))) throw new Error("Movimentacao nao encontrada.");
    if (transaction.data.bank_direction !== "outflow" || ["cancelled", "disputed"].includes(String(transaction.data.status ?? ""))) throw new Error("Selecione uma movimentacao de saida valida.");
    const identity = ruleIdentity(rowFingerprint({ description: String(transaction.data.description), merchant: transaction.data.merchant ? String(transaction.data.merchant) : null, provider_metadata: transaction.data.provider_metadata, source: transaction.data.source ? String(transaction.data.source) : null }));
    const existingRule = await supabase.from("expense_establishment_rules").select("id,establishment_id,expense_establishments(name,normalized_name)")
      .eq("workspace_id", parsed.workspaceId).eq("match_type", identity.matchType).eq("match_hash", identity.matchHash).eq("is_active", true).maybeSingle();
    if (existingRule.error) throw new Error("Nao foi possivel verificar o destinatario.");
    if (existingRule.data) {
      const existing = Array.isArray(existingRule.data.expense_establishments) ? existingRule.data.expense_establishments[0] : existingRule.data.expense_establishments;
      if (existing?.normalized_name !== normalizeFinancialName(parsed.name)) throw new Error(`Este destinatario ja esta associado a ${existing?.name ?? "outro estabelecimento"}.`);
      const restored = await supabase.from("expense_establishment_transactions").upsert({ workspace_id: parsed.workspaceId, establishment_id: existingRule.data.establishment_id, transaction_id: parsed.sourceId, rule_id: existingRule.data.id, association_source: "manual", is_active: true, created_by: user.id, unlinked_at: null }, { onConflict: "transaction_id" });
      if (restored.error) throw new Error("Nao foi possivel restaurar o vinculo.");
      refreshEstablishmentViews();
      return { ok: true as const, message: `Movimentacao associada novamente a ${existing.name}.` };
    }
    const establishment = await findOrCreateEstablishment(supabase, user.id, parsed);
    const rule = await supabase.from("expense_establishment_rules").insert({ workspace_id: parsed.workspaceId, establishment_id: establishment.id, created_by: user.id, provider: transaction.data.source, match_type: identity.matchType, match_hash: identity.matchHash, display_name: identity.displayName, masked_identifier: identity.maskedIdentifier, apply_to_history: parsed.applyToHistory }).select("id").single();
    if (rule.error || !rule.data) throw new Error("Nao foi possivel criar a regra automatica.");
    let matchedIds = [parsed.sourceId];
    if (parsed.applyToHistory) {
      const candidates = await supabase.from("financial_transactions").select("id,description,merchant,provider_metadata,source")
        .eq("owner_id", user.id).eq("bank_direction", "outflow").or(`workspace_id.eq.${parsed.workspaceId},workspace_id.is.null`).not("status", "in", '("cancelled","disputed")').limit(3000);
      if (!candidates.error) matchedIds = (candidates.data ?? []).filter(row => sameRule(identity, rowFingerprint({ description: String(row.description ?? ""), merchant: row.merchant ? String(row.merchant) : null, provider_metadata: row.provider_metadata, source: row.source ? String(row.source) : null }))).map(row => String(row.id));
    }
    const existingLinks = await supabase.from("expense_establishment_transactions").select("transaction_id").in("transaction_id", matchedIds);
    const alreadyLinked = new Set((existingLinks.data ?? []).map(row => String(row.transaction_id)));
    const links = matchedIds.filter(id => !alreadyLinked.has(id)).map(id => ({ workspace_id: parsed.workspaceId, establishment_id: establishment.id, transaction_id: id, rule_id: rule.data.id, association_source: id === parsed.sourceId ? "manual" : "historical_backfill", created_by: user.id }));
    if (links.length) {
      const linked = await supabase.from("expense_establishment_transactions").insert(links);
      if (linked.error) throw new Error("O estabelecimento foi criado, mas o historico nao pode ser associado.");
    }
    if (parsed.categoryId && matchedIds.length) await supabase.from("financial_transactions").update({ category_id: parsed.categoryId }).in("id", matchedIds).is("category_id", null).eq("manually_confirmed", false);
    refreshEstablishmentViews();
    const historicalCount = Math.max(0, links.length - 1);
    return { ok: true as const, message: historicalCount ? `Estabelecimento associado. ${historicalCount} pagamento(s) anterior(es) tambem foram encontrados.` : "Estabelecimento associado. As proximas saidas do mesmo destinatario serao reconhecidas automaticamente." };
  } catch (error) {
    return { ok: false as const, message: error instanceof Error ? error.message : "Nao foi possivel associar o estabelecimento." };
  }
}

export async function unlinkExpenseEstablishmentAction(data: FormData) {
  try {
    const workspaceId = uuid.parse(data.get("workspace_id"));
    const sourceKind = z.enum(["transaction", "card_purchase", "invoice_entry"]).parse(data.get("source_kind"));
    const sourceId = uuid.parse(data.get("source_id"));
    const { supabase } = await requireFinanceAccess();
    const result = await supabase.from("expense_establishment_transactions").update({ is_active: false, unlinked_at: new Date().toISOString() })
      .eq("workspace_id", workspaceId).eq(sourceKind === "transaction" ? "transaction_id" : sourceKind === "card_purchase" ? "card_purchase_id" : "invoice_entry_id", sourceId);
    if (result.error) throw new Error("Nao foi possivel remover o vinculo.");
    refreshEstablishmentViews();
    return { ok: true as const, message: "Estabelecimento removido desta movimentacao." };
  } catch (error) {
    return { ok: false as const, message: error instanceof Error ? error.message : "Nao foi possivel remover o vinculo." };
  }
}
