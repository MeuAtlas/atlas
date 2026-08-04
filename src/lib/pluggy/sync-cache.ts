import "server-only";

import { revalidatePath, revalidateTag } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { invalidateOpenInvoiceCache } from "@/modules/finance/open-invoice-cache";
import type { PluggySyncSummary } from "./incremental-sync";
import { pathsForUpdatedPluggyResources } from "./scheduled-sync";
import { invalidateIntegrationsCache } from "@/modules/finance/integrations-cache";

export const pluggySyncCacheTags = {
  item: (itemId: string) => `pluggy-item:${itemId}`,
  accounts: (workspaceId: string) => `financial-accounts:${workspaceId}`,
  transactions: (workspaceId: string) => `financial-transactions:${workspaceId}`,
  creditCards: (workspaceId: string) => `financial-credit-cards:${workspaceId}`,
  bills: (workspaceId: string) => `financial-bills:${workspaceId}`,
  reports: (workspaceId: string) => `financial-reports:${workspaceId}`,
};

export async function invalidatePluggySyncCaches(input: {
  supabase: SupabaseClient;
  ownerId: string;
  workspaceId?: string | null;
  integrationId?: string;
  summary: PluggySyncSummary;
}) {
  invalidateIntegrationsCache(
    input.workspaceId ?? input.ownerId,
    input.integrationId,
  );
  const scope = input.workspaceId ?? input.ownerId;
  const changedResources = new Set(input.summary.resources
    .filter(resource => ["succeeded", "succeeded_with_warnings"].includes(resource.status))
    .map(resource => resource.resourceType));
  const tags = [
    ...(input.integrationId ? [pluggySyncCacheTags.item(input.integrationId)] : []),
    ...(changedResources.has("accounts") ? [pluggySyncCacheTags.accounts(scope)] : []),
    ...(changedResources.has("transactions") ? [pluggySyncCacheTags.transactions(scope)] : []),
    ...(changedResources.has("credit_cards") ? [pluggySyncCacheTags.creditCards(scope)] : []),
    ...(changedResources.has("bills") ? [pluggySyncCacheTags.bills(scope)] : []),
    ...((["accounts", "transactions", "credit_cards", "bills"] as const).some(
      resource => changedResources.has(resource),
    ) ? [pluggySyncCacheTags.reports(scope)] : []),
  ];
  for (const tag of new Set(tags)) revalidateTag(tag, { expire: 0 });
  for (const path of pathsForUpdatedPluggyResources(input.summary)) {
    revalidatePath(path);
  }
  if (changedResources.has("transactions")) {
    revalidatePath("/financeiro/relatorios/[year]/[month]", "page");
  }

  const invoiceResourceChanged = input.summary.resources.some(
    resource =>
      ["succeeded", "succeeded_with_warnings"].includes(resource.status) &&
      resource.inserted + resource.updated > 0 &&
      (["credit_cards", "bills"].includes(resource.resourceType) ||
        (resource.resourceType === "transactions" &&
          resource.entityType === "credit_card")),
  );
  if (!invoiceResourceChanged) return;

  const invoices = await input.supabase
    .from("card_invoices")
    .select("id,workspace_id")
    .eq("owner_id", input.ownerId)
    .eq("status", "open");
  if (invoices.error) return;
  invalidateOpenInvoiceCache(
    (invoices.data ?? []).map(invoice => ({
      cycleId: String(invoice.id),
      workspaceId: invoice.workspace_id
        ? String(invoice.workspace_id)
        : null,
    })),
  );
}
