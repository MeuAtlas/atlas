import "server-only";

import { revalidatePath, revalidateTag } from "next/cache";
import { openInvoiceCacheTag } from "./open-card-invoice";

export type OpenInvoiceCacheIdentity = {
  workspaceId?: string | null;
  cycleId: string;
};

export function invalidateOpenInvoiceCache(
  identities: OpenInvoiceCacheIdentity[] = [],
) {
  for (const identity of identities) {
    revalidateTag(
      openInvoiceCacheTag(identity.workspaceId, identity.cycleId),
      { expire: 0 },
    );
  }
  revalidatePath("/financeiro");
  revalidatePath("/financeiro/cartoes");
  revalidatePath("/financeiro/movimentacoes");
}
