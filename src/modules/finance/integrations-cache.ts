import { revalidatePath, revalidateTag } from "next/cache";

export const integrationsCacheTag = (workspaceId: string) =>
  `finance:integrations:${workspaceId}`;
export const integrationCacheTag = (
  workspaceId: string,
  integrationId: string,
) => `finance:integration:${workspaceId}:${integrationId}`;
export const syncHistoryCacheTag = (workspaceId: string) =>
  `finance:sync-history:${workspaceId}`;
export const syncProductsCacheTag = (workspaceId: string) =>
  `finance:sync-products:${workspaceId}`;
export const automaticSyncCacheTag = (workspaceId: string) =>
  `finance:automatic-sync:${workspaceId}`;

export function invalidateIntegrationsCache(
  workspaceId: string,
  integrationId?: string,
) {
  const tags = [
    integrationsCacheTag(workspaceId),
    syncHistoryCacheTag(workspaceId),
    syncProductsCacheTag(workspaceId),
    automaticSyncCacheTag(workspaceId),
    ...(integrationId ? [integrationCacheTag(workspaceId, integrationId)] : []),
  ];
  tags.forEach(tag => revalidateTag(tag, { expire: 0 }));
  revalidatePath("/financeiro/integracoes");
}
