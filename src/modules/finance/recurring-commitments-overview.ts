import type {
  CommitmentOccurrence,
  FinancialCommitment,
} from "./commitments";

export type RecurringCommitmentFilter =
  | "all"
  | "own"
  | "dependents"
  | "household"
  | "work"
  | "travel"
  | "paid"
  | "pending"
  | "overdue";

export type RecurringCommitmentSource = {
  commitment: FinancialCommitment;
  categoryName: string | null;
  accountName: string | null;
  cardName: string | null;
  people: Array<{ id: string; name: string; isDependent: boolean }>;
  occurrence: CommitmentOccurrence | null;
};

export type RecurringCommitmentItem = {
  commitmentId: string;
  occurrenceId: string | null;
  title: string;
  categoryName: string | null;
  personId: string | null;
  personName: string | null;
  contextId: string | null;
  contextType: "personal" | "household" | "work" | "travel";
  contextName: string | null;
  amountCents: number;
  expectedAmountCents: number;
  actualAmountCents: number | null;
  dueDate: string | null;
  dueDay: number | null;
  paymentMethod: string | null;
  accountName: string | null;
  cardName: string | null;
  frequency: string | null;
  status: "paid" | "pending" | "overdue" | "projected" | "paused";
  isPayrollDeduction: boolean;
  isDependent: boolean;
};

export type RecurringCommitmentGroup = {
  groupType: "own" | "dependent" | "household" | "work" | "travel";
  personId?: string;
  personName?: string;
  contextId?: string;
  contextName: string;
  total: number;
  paid: number;
  pending: number;
  overdue: number;
  items: RecurringCommitmentItem[];
};

export type RecurringCommitmentsOverview = {
  workspaceId: string;
  competenceMonth: string;
  totalRecurring: number;
  ownRecurring: number;
  dependentsRecurring: number;
  householdRecurring: number;
  paidAmount: number;
  pendingAmount: number;
  overdueAmount: number;
  nextDue: {
    commitmentId: string;
    date: string;
    amountCents: number;
  } | null;
  groups: RecurringCommitmentGroup[];
  occurrences: RecurringCommitmentItem[];
  warnings: string[];
};

const recurringTypes = new Set([
  "recurring",
  "subscription",
  "payroll_deduction",
]);

function resolveStatus(
  commitment: FinancialCommitment,
  occurrence: CommitmentOccurrence | null,
  competenceMonth: string,
  today: string,
): RecurringCommitmentItem["status"] {
  if (commitment.status === "paused") return "paused";
  if (!occurrence) return competenceMonth > `${today.slice(0, 7)}-01`
    ? "projected"
    : "pending";
  if (
    occurrence.status === "paid" ||
    occurrence.paymentDate ||
    occurrence.linkedTransactionId ||
    occurrence.linkedCardMovementId
  ) return "paid";
  if (occurrence.status === "overdue") return "overdue";
  if (occurrence.expectedDueDate && occurrence.expectedDueDate < today) {
    return commitment.isPayrollDeduction ? "pending" : "overdue";
  }
  if (
    occurrence.status === "projected" ||
    occurrence.competenceMonth > `${today.slice(0, 7)}-01`
  ) return "projected";
  return "pending";
}

function groupKey(item: RecurringCommitmentItem) {
  if (item.contextType !== "personal") {
    return `context:${item.contextType}:${item.contextId ?? "default"}`;
  }
  if (item.personId) return `dependent:${item.personId}`;
  return "own";
}

export function filterRecurringCommitmentGroups(
  groups: RecurringCommitmentGroup[],
  filter: RecurringCommitmentFilter,
) {
  if (filter === "all") return groups;
  return groups.map(group => ({
    ...group,
    items: group.items.filter(item => {
      if (filter === "own") return group.groupType === "own";
      if (filter === "dependents") return group.groupType === "dependent";
      if (filter === "household") return group.groupType === "household";
      if (filter === "work") return group.groupType === "work";
      if (filter === "travel") return group.groupType === "travel";
      return item.status === filter;
    }),
  })).filter(group => group.items.length > 0).map(group => ({
    ...group,
    total: group.items.reduce((sum, item) => sum + item.amountCents, 0),
    paid: group.items.filter(item => item.status === "paid")
      .reduce((sum, item) => sum + item.amountCents, 0),
    pending: group.items.filter(item => item.status === "pending")
      .reduce((sum, item) => sum + item.amountCents, 0),
    overdue: group.items.filter(item => item.status === "overdue")
      .reduce((sum, item) => sum + item.amountCents, 0),
  }));
}

export function getRecurringCommitmentsOverview(input: {
  workspaceId: string;
  competenceMonth: string;
  filters?: RecurringCommitmentFilter;
  sources: RecurringCommitmentSource[];
  today?: string;
}): RecurringCommitmentsOverview {
  const competenceMonth = `${input.competenceMonth.slice(0, 7)}-01`;
  const today = input.today ?? new Date().toISOString().slice(0, 10);
  const warnings: string[] = [];
  const items = input.sources
    .filter(({ commitment }) =>
      recurringTypes.has(commitment.commitmentType) &&
      commitment.cashFlowDirection !== "income" &&
      commitment.includeInMonthlyBudget !== false &&
      ["active", "paused"].includes(commitment.status)
    )
    .map(source => {
      const { commitment, occurrence } = source;
      const primaryPerson = source.people[0] ?? null;
      const contextType = commitment.contextType ??
        (commitment.analysisGroupType === "household"
          ? "household"
          : "personal");
      const specialContext = contextType !== "personal";
      const contextNames = {
        personal: null,
        household: "Casa",
        work: "Trabalho",
        travel: "Viagem",
      } as const;
      const status = resolveStatus(
        commitment,
        occurrence,
        competenceMonth,
        today,
      );
      const expectedAmountCents =
        occurrence?.expectedAmountCents ??
        commitment.expectedAmountCents ??
        0;
      const actualAmountCents = occurrence?.actualAmountCents ?? null;
      const amountCents = status === "paid"
        ? actualAmountCents ?? expectedAmountCents
        : expectedAmountCents;
      if (!occurrence && commitment.status === "active") {
        warnings.push(
          `${commitment.title}: gerar a ocorrência de ${competenceMonth.slice(0, 7)}.`,
        );
      }
      if (!source.categoryName) {
        warnings.push(`${commitment.title}: adicionar uma categoria.`);
      }
      if (
        actualAmountCents !== null &&
        actualAmountCents > expectedAmountCents
      ) {
        warnings.push(
          `${commitment.title}: revisar valor realizado acima do previsto.`,
        );
      }
      if (status === "overdue") {
        warnings.push(`${commitment.title}: vincular ou confirmar o pagamento.`);
      }
      return {
        commitmentId: commitment.id,
        occurrenceId: occurrence?.id ?? null,
        title: commitment.title,
        categoryName: source.categoryName,
        personId: specialContext ? null : primaryPerson?.id ?? null,
        personName: specialContext ? null : primaryPerson?.name ?? null,
        contextId: specialContext ? commitment.analysisGroupId ?? null : null,
        contextType,
        contextName: specialContext
          ? commitment.analysisGroupName ?? contextNames[contextType]
          : null,
        amountCents,
        expectedAmountCents,
        actualAmountCents,
        dueDate: occurrence?.expectedDueDate ?? commitment.nextDueDate,
        dueDay: commitment.dueDay,
        paymentMethod: commitment.paymentMethod,
        accountName: source.accountName,
        cardName: source.cardName,
        frequency: commitment.recurrenceFrequency,
        status,
        isPayrollDeduction: commitment.isPayrollDeduction,
        isDependent: specialContext ? false : primaryPerson?.isDependent ?? false,
      } satisfies RecurringCommitmentItem;
    });

  const groupMap = new Map<string, RecurringCommitmentGroup>();
  for (const item of items) {
    const key = groupKey(item);
    const group = groupMap.get(key) ?? {
      groupType: item.contextType !== "personal"
        ? item.contextType
        : item.personId
          ? "dependent"
          : "own",
      ...(item.personId
        ? { personId: item.personId, personName: item.personName ?? undefined }
        : {}),
      ...(item.contextType !== "personal"
        ? { contextId: item.contextId ?? undefined }
        : {}),
      contextName: item.contextName ?? item.personName ?? "Minhas contas",
      total: 0,
      paid: 0,
      pending: 0,
      overdue: 0,
      items: [],
    } satisfies RecurringCommitmentGroup;
    group.items.push(item);
    if (item.status !== "paused") group.total += item.amountCents;
    if (item.status === "paid") group.paid += item.amountCents;
    if (item.status === "pending") group.pending += item.amountCents;
    if (item.status === "overdue") group.overdue += item.amountCents;
    groupMap.set(key, group);
  }
  const groupOrder = {
    own: 0,
    household: 1,
    work: 2,
    travel: 3,
    dependent: 4,
  };
  const groups = [...groupMap.values()]
    .map(group => ({
      ...group,
      items: group.items.sort((left, right) =>
        (left.dueDate ?? "9999-12-31").localeCompare(
          right.dueDate ?? "9999-12-31",
        )
      ),
    }))
    .sort((left, right) =>
      groupOrder[left.groupType] - groupOrder[right.groupType] ||
      left.contextName.localeCompare(right.contextName, "pt-BR")
    );
  const activeItems = items.filter(item => item.status !== "paused");
  const next = activeItems.filter(item =>
    item.dueDate &&
    ["pending", "overdue", "projected"].includes(item.status)
  ).sort((left, right) =>
    (left.dueDate ?? "").localeCompare(right.dueDate ?? "")
  )[0] ?? null;
  const result = {
    workspaceId: input.workspaceId,
    competenceMonth,
    totalRecurring: activeItems.reduce((sum, item) => sum + item.amountCents, 0),
    ownRecurring: activeItems.filter(item =>
      !item.personId && item.contextType === "personal"
    ).reduce((sum, item) => sum + item.amountCents, 0),
    dependentsRecurring: activeItems.filter(item =>
      item.personId && item.isDependent
    ).reduce((sum, item) => sum + item.amountCents, 0),
    householdRecurring: activeItems.filter(item =>
      item.contextType === "household"
    )
      .reduce((sum, item) => sum + item.amountCents, 0),
    paidAmount: activeItems.filter(item => item.status === "paid")
      .reduce((sum, item) => sum + item.amountCents, 0),
    pendingAmount: activeItems.filter(item =>
      ["pending", "overdue"].includes(item.status)
    ).reduce((sum, item) => sum + item.amountCents, 0),
    overdueAmount: activeItems.filter(item => item.status === "overdue")
      .reduce((sum, item) => sum + item.amountCents, 0),
    nextDue: next?.dueDate
      ? {
          commitmentId: next.commitmentId,
          date: next.dueDate,
          amountCents: next.amountCents,
        }
      : null,
    groups,
    occurrences: items,
    warnings: [...new Set(warnings)],
  };
  return {
    ...result,
    groups: filterRecurringCommitmentGroups(
      result.groups,
      input.filters ?? "all",
    ),
  };
}
