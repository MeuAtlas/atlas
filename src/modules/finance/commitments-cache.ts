import { revalidatePath, revalidateTag } from "next/cache";

export const commitmentsCacheTag = (workspaceId: string) =>
  `finance:commitments:${workspaceId}`;
export const incomeExpensesCacheTag = (workspaceId: string, month?: string) =>
  month
    ? `finance:income-expenses:${workspaceId}:${month.slice(0, 7)}`
    : `finance:income-expenses:${workspaceId}`;
export const incomeCacheTag = (workspaceId: string, incomeId?: string) =>
  incomeId
    ? `finance:income:${workspaceId}:${incomeId}`
    : `finance:income:${workspaceId}`;
export const expensesCacheTag = (workspaceId: string) =>
  `finance:expenses:${workspaceId}`;
export const occurrencesCacheTag = (workspaceId: string) =>
  `finance:occurrences:${workspaceId}`;
export const commitmentsMonthCacheTag = (
  workspaceId: string,
  month: string,
) => `finance:commitments:month:${workspaceId}:${month}`;
export const peopleCacheTag = (workspaceId: string) =>
  `finance:people:${workspaceId}`;
export const personCacheTag = (workspaceId: string, personId: string) =>
  `finance:person:${workspaceId}:${personId}`;
export const personDashboardCacheTag = (
  workspaceId: string,
  personId: string,
  period = "all",
) => `finance:person:dashboard:${workspaceId}:${personId}:${period}`;
export const movementsCacheTag = (workspaceId: string) =>
  `finance:movements:${workspaceId}`;
export const reimbursementsCacheTag = (workspaceId: string) =>
  `finance:reimbursements:${workspaceId}`;
export const personPixCacheTag = (workspaceId: string, personId: string) =>
  `finance:pix:${workspaceId}:${personId}`;
export const planningCacheTag = (workspaceId: string) =>
  `finance:planning:${workspaceId}`;
export const entitiesCacheTag = (workspaceId: string) =>
  `finance:entities:${workspaceId}`;
export const overviewCacheTag = (workspaceId: string) =>
  `finance:overview:${workspaceId}`;
export const reportsCacheTag = (workspaceId: string) =>
  `finance:reports:${workspaceId}`;

export function invalidateCommitmentsCache(
  workspaceId: string,
  options: { month?: string; personId?: string } = {},
) {
  const tags = [
    commitmentsCacheTag(workspaceId),
    incomeExpensesCacheTag(workspaceId),
    incomeCacheTag(workspaceId),
    expensesCacheTag(workspaceId),
    occurrencesCacheTag(workspaceId),
    peopleCacheTag(workspaceId),
    movementsCacheTag(workspaceId),
    reimbursementsCacheTag(workspaceId),
    planningCacheTag(workspaceId),
    entitiesCacheTag(workspaceId),
    overviewCacheTag(workspaceId),
    reportsCacheTag(workspaceId),
    ...(options.month
      ? [
          commitmentsMonthCacheTag(workspaceId, options.month),
          incomeExpensesCacheTag(workspaceId, options.month),
        ]
      : []),
    ...(options.personId
      ? [
          personCacheTag(workspaceId, options.personId),
          personDashboardCacheTag(workspaceId, options.personId),
          personPixCacheTag(workspaceId, options.personId),
        ]
      : []),
  ];
  tags.forEach(tag => revalidateTag(tag, { expire: 0 }));
  [
    "/financeiro",
    "/financeiro/compromissos",
    "/financeiro/receitas-despesas",
    "/financeiro/movimentacoes",
    "/financeiro/planejamento",
    "/financeiro/relatorios",
  ].forEach(path => revalidatePath(path));
}
