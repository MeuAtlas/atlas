export type CardCycleStatus =
  | "open"
  | "closed"
  | "paid"
  | "overdue"
  | "estimated"
  | "unknown";
export type CardCycleKind = "open" | "closed" | "paid" | "estimated";

export type CardCycleSource =
  | "pdf"
  | "pluggy_bill"
  | "manual"
  | "calculated";

export interface AvailableCardCycle {
  cycleId: string;
  billId: string | null;
  referenceMonth: string;
  kind: CardCycleKind;
  label: string;
  compactLabel: string;
  cycleStartDate: string;
  cycleEndDate: string;
  closingDate: string | null;
  dueDate: string | null;
  status: CardCycleStatus;
  source: CardCycleSource;
  cardAccountId: string;
  cardId: string;
  cardIds: string[];
  cardLabel: string;
  providerBillId: string | null;
  officialTotal: number | null;
  reconciliationDifference: number | null;
  identifiedEntriesTotal: number | null;
  creditsTotal: number | null;
  paymentsTotal: number | null;
  financeChargesTotal: number | null;
  previousBalance: number | null;
  lastReliableTotal: number | null;
  dataCompleteness: string;
  isCurrent: boolean;
}

export interface CardCycleRow {
  id: string;
  card_id: string;
  reference_month: string;
  cycle_start_date: string | null;
  cycle_end_date: string | null;
  closing_date: string | null;
  due_date: string | null;
  status: string | null;
  source: string | null;
  document_id: string | null;
  provider_bill_id: string | null;
  official_total: number | string | null;
  provider_invoice_total?: number | string | null;
  manual_invoice_total?: number | string | null;
  confirmed_invoice_total?: number | string | null;
  confirmed_open_total?: number | string | null;
  confirmed_open_total_at?: string | null;
  total_amount: number | string | null;
  reconciliation_difference: number | string | null;
  identified_entries_total?: number | string | null;
  credits_total?: number | string | null;
  payments_total?: number | string | null;
  finance_charges_total?: number | string | null;
  previous_balance?: number | string | null;
  last_reliable_invoice_total?: number | string | null;
  current_display_total?: number | string | null;
  data_completeness?: string | null;
  credit_cards?: {
    name: string;
    institution_name: string | null;
    last_four_digits: string | null;
  } | null;
}

export interface ConfirmedPdfCycleDocument {
  id: string;
  parsed_payload: unknown;
  confirmed_at?: string | null;
}

export function restoreConfirmedPdfCycleAxes(
  rows: CardCycleRow[],
  documents: ConfirmedPdfCycleDocument[],
) {
  const byId = new Map(documents.map(document => [document.id, document]));
  return rows.map(row => {
    if (!row.document_id) return row;
    const document = byId.get(row.document_id);
    if (!document || document.confirmed_at === null) return row;
    const payload = document.parsed_payload as {
      parsed?: {
        cycleStartDate?: string | null;
        cycleEndDate?: string | null;
        closingDate?: string | null;
        dueDate?: string | null;
      };
    } | null;
    const parsed = payload?.parsed;
    if (!parsed) return row;
    const closingDate = parsed.closingDate ?? parsed.cycleEndDate ?? row.closing_date;
    const cycleEndDate = parsed.cycleEndDate ?? closingDate ?? row.cycle_end_date;
    return {
      ...row,
      cycle_start_date: parsed.cycleStartDate ?? row.cycle_start_date,
      cycle_end_date: cycleEndDate,
      closing_date: closingDate,
      due_date: parsed.dueDate ?? row.due_date,
      status: ["open", "estimated"].includes(row.status ?? "") ? "closed" : row.status,
      source: "pdf",
    };
  });
}

const sourcePriority: Record<CardCycleSource, number> = {
  pdf: 4,
  pluggy_bill: 3,
  manual: 2,
  calculated: 1,
};

function cycleSource(row: CardCycleRow): CardCycleSource {
  if (row.document_id || row.source === "pdf") return "pdf";
  if (row.provider_bill_id || row.source === "pluggy_bill") return "pluggy_bill";
  if (
    row.source === "manual" ||
    row.source === "payment_confirmation" ||
    row.source === "manual_bank_confirmation"
  ) return "manual";
  return "calculated";
}

function cycleStatus(value: string | null): CardCycleStatus {
  if (value === "open") return "open";
  if (value === "paid") return "paid";
  if (value === "overdue") return "overdue";
  if (["closed", "due", "partial", "partially_paid"].includes(value ?? "")) {
    return "closed";
  }
  return "unknown";
}

function cycleKind(status: CardCycleStatus, source: CardCycleSource): CardCycleKind {
  if (status === "paid") return "paid";
  if (status === "open") return source === "calculated" ? "estimated" : "open";
  if (status === "estimated") return "estimated";
  return "closed";
}

function shortDate(value: string) {
  return `${value.slice(8, 10)}/${value.slice(5, 7)}`;
}

function monthLabel(value: string) {
  const [year, month] = value.split("-").map(Number);
  const label = new Intl.DateTimeFormat("pt-BR", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, 1)));
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function numberOrNull(value: number | string | null | undefined) {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function normalizeAvailableCardCycles(
  rows: CardCycleRow[],
  today = new Date().toISOString().slice(0, 10),
): AvailableCardCycle[] {
  const selected = new Map<string, CardCycleRow>();
  for (const row of rows) {
    if (!row.cycle_start_date || !row.cycle_end_date || !row.card_id) continue;
    const key = `${row.card_id}|${row.cycle_start_date}|${row.cycle_end_date}`;
    const current = selected.get(key);
    if (
      !current ||
      sourcePriority[cycleSource(row)] > sourcePriority[cycleSource(current)]
    ) {
      selected.set(key, row);
    }
  }
  const exactCycles = [...selected.values()];
  const relevantCycles = exactCycles.filter(row => {
    if (cycleSource(row) !== "calculated" || cycleStatus(row.status) !== "open") {
      return true;
    }
    const reference = (row.due_date ?? row.reference_month).slice(0, 7);
    return !exactCycles.some(other =>
      other.id !== row.id &&
      other.card_id === row.card_id &&
      cycleStatus(other.status) === "open" &&
      (other.due_date ?? other.reference_month).slice(0, 7) === reference &&
      sourcePriority[cycleSource(other)] > sourcePriority.calculated
    );
  });
  return relevantCycles
    .map(row => {
      const cycleStartDate = row.cycle_start_date!;
      const cycleEndDate = row.cycle_end_date!;
      const status = cycleStatus(row.status);
      const isCurrent =
        status === "open" &&
        cycleStartDate <= today &&
        cycleEndDate >= today;
      const label = isCurrent
        ? "Atual"
        : monthLabel(row.due_date ?? row.reference_month);
      const lastFour = row.credit_cards?.last_four_digits;
      const cardLabel = [
        row.credit_cards?.institution_name,
        row.credit_cards?.name,
        lastFour ? `final ${lastFour}` : null,
      ].filter(Boolean).join(" · ") || "Cartão";
      return {
        cycleId: row.id,
        referenceMonth: row.reference_month,
        billId:
          row.document_id || row.provider_bill_id ||
          ["pdf", "pluggy_bill"].includes(row.source ?? "")
            ? row.id
            : null,
        kind: cycleKind(status, cycleSource(row)),
        label,
        compactLabel: `${label} — ${shortDate(cycleStartDate)} a ${shortDate(cycleEndDate)}`,
        cycleStartDate,
        cycleEndDate,
        closingDate: row.closing_date,
        dueDate: row.due_date,
        status,
        source: cycleSource(row),
        cardAccountId: row.card_id,
        cardId: row.card_id,
        cardIds: [row.card_id],
        cardLabel,
        providerBillId: row.provider_bill_id,
        officialTotal:
          numberOrNull(row.confirmed_open_total) ??
          numberOrNull(row.official_total) ??
          numberOrNull(row.provider_invoice_total) ??
          (cycleSource(row) === "pluggy_bill"
            ? numberOrNull(row.total_amount)
            : cycleSource(row) === "manual"
              ? numberOrNull(row.confirmed_invoice_total) ??
                numberOrNull(row.manual_invoice_total)
              : null),
        reconciliationDifference: numberOrNull(row.reconciliation_difference),
        identifiedEntriesTotal: numberOrNull(row.identified_entries_total),
        creditsTotal: numberOrNull(row.credits_total),
        paymentsTotal: numberOrNull(row.payments_total),
        financeChargesTotal: numberOrNull(row.finance_charges_total),
        previousBalance: numberOrNull(row.previous_balance),
        lastReliableTotal:
          numberOrNull(row.last_reliable_invoice_total) ??
          numberOrNull(row.current_display_total),
        dataCompleteness: row.data_completeness ?? "unknown",
        isCurrent,
      } satisfies AvailableCardCycle;
    })
    .sort((left, right) =>
      Number(right.isCurrent) - Number(left.isCurrent) ||
      right.cycleEndDate.localeCompare(left.cycleEndDate) ||
      sourcePriority[right.source] - sourcePriority[left.source],
    );
}

export function defaultCardCycle(cycles: AvailableCardCycle[]) {
  return cycles.find(cycle => cycle.isCurrent) ?? cycles[0] ?? null;
}

export function resolveLegacyCardCycle(
  cycles: AvailableCardCycle[],
  value: string | undefined,
) {
  if (!value) return null;
  return cycles.find(cycle => cycle.cycleId === value || cycle.billId === value) ??
    cycles.find(cycle => cycle.dueDate?.startsWith(value)) ??
    cycles.find(cycle => cycle.cycleEndDate.startsWith(value)) ??
    cycles.find(cycle =>
      cycle.label.toLocaleLowerCase("pt-BR") === value.toLocaleLowerCase("pt-BR")
    ) ??
    null;
}
