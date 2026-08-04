import type { MovementListItem } from "./movement-filters";

export type CardMovementDayGroup = {
  date: string;
  items: MovementListItem[];
  total: number;
};

function movementIdentity(item: MovementListItem) {
  return `${item.sourceKind}:${item.id}`;
}

export function isInstallmentTransaction(item: MovementListItem) {
  const current = item.installmentNumber;
  const total = item.installmentTotal;
  return Number.isInteger(current) && Number.isInteger(total) &&
    (current ?? 0) >= 1 && (total ?? 0) > 1 && (current ?? 0) <= (total ?? 0);
}

export function formatInstallmentLabel(item: MovementListItem) {
  return isInstallmentTransaction(item)
    ? `${item.installmentNumber}/${item.installmentTotal}`
    : "—";
}

export function splitCardTransactions(items: MovementListItem[]) {
  const unique = new Map<string, MovementListItem>();
  for (const item of items) {
    const key = movementIdentity(item);
    if (!unique.has(key)) unique.set(key, item);
  }
  const installments: MovementListItem[] = [];
  const regular: MovementListItem[] = [];
  for (const item of unique.values()) {
    (isInstallmentTransaction(item) ? installments : regular).push(item);
  }
  return { installments, regular };
}

export function calculateCardTransactionsTotal(items: MovementListItem[]) {
  return items.reduce((total, item) => {
    if (item.isIgnored || item.amountBrl === null) return total;
    const amount = Math.abs(item.amountBrl);
    return total + (item.consumptionEffect === "income" ? -amount : amount);
  }, 0);
}

export function groupRegularTransactionsByDate(items: MovementListItem[]) {
  const groups = new Map<string, MovementListItem[]>();
  for (const item of items) {
    const group = groups.get(item.date) ?? [];
    group.push(item);
    groups.set(item.date, group);
  }
  return [...groups.entries()].map(([date, group]) => ({
    date,
    items: group,
    total: calculateCardTransactionsTotal(group),
  }));
}

export function buildCardMovementsViewModel(items: MovementListItem[]) {
  const { installments, regular } = splitCardTransactions(items);
  return {
    installments,
    regular,
    regularGroups: groupRegularTransactionsByDate(regular),
    installmentTotal: calculateCardTransactionsTotal(installments),
    regularTotal: calculateCardTransactionsTotal(regular),
  };
}
