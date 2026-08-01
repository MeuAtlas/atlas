import "server-only";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { invalidateOpenInvoiceCache } from "@/modules/finance/open-invoice-cache";
import type { PluggySyncSummary } from "./incremental-sync";
import { pathsForUpdatedPluggyResources } from "./scheduled-sync";
import { invalidateIntegrationsCache } from "@/modules/finance/integrations-cache";

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
  for (const path of pathsForUpdatedPluggyResources(input.summary)) {
    revalidatePath(path);
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
