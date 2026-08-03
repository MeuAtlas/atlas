export type StatementChangeReason =
  | "new_transaction"
  | "transaction_updated"
  | "transaction_deleted"
  | "bank_total_changed"
  | "credit_received"
  | "refund_received"
  | "manual_adjustment"
  | "complete_resync"
  | "partial_sync_preserved"
  | "cache_refresh"
  | "unknown";

export type StatementTotalSource =
  | "bank_bill"
  | "complete_transaction_sum"
  | "reliable_snapshot"
  | "partial_estimate"
  | "manual"
  | "legacy";

const money = (value: unknown) => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed)
    ? Math.round(Math.abs(parsed) * 100) / 100
    : null;
};

const REDUCTION_EVIDENCE = new Set<StatementChangeReason>([
  "transaction_updated",
  "transaction_deleted",
  "bank_total_changed",
  "credit_received",
  "refund_received",
  "manual_adjustment",
  "complete_resync",
]);

export function resolveStatementDisplayAmount(input: {
  bankTotalAmount?: unknown;
  calculatedTotalAmount?: unknown;
  calculationCompleteness: "complete" | "partial" | "unknown";
  lastReliableTotalAmount?: unknown;
  previousDisplayTotalAmount?: unknown;
  manualTotalAmount?: unknown;
  changeReason?: StatementChangeReason | null;
  bankTotalCanReduce?: boolean;
}) {
  const bank = money(input.bankTotalAmount);
  const calculated = money(input.calculatedTotalAmount);
  const lastReliable = money(input.lastReliableTotalAmount);
  const previousDisplay = money(input.previousDisplayTotalAmount);
  const manual = money(input.manualTotalAmount);
  const baseline = lastReliable ?? previousDisplay;
  const reason = input.changeReason ?? "unknown";

  if (
    bank !== null &&
    baseline !== null &&
    bank < baseline &&
    input.bankTotalCanReduce === false
  ) {
    return {
      displayTotalAmount: baseline,
      lastReliableTotalAmount: lastReliable ?? baseline,
      source: "reliable_snapshot" as StatementTotalSource,
      preserved: true,
      reason: "partial_sync_preserved" as StatementChangeReason,
    };
  }
  if (bank !== null) {
    return {
      displayTotalAmount: bank,
      lastReliableTotalAmount: bank,
      source: "bank_bill" as StatementTotalSource,
      preserved: false,
      reason: baseline !== null && bank !== baseline
        ? "bank_total_changed" as StatementChangeReason
        : reason,
    };
  }
  if (manual !== null) {
    return {
      displayTotalAmount: manual,
      lastReliableTotalAmount: manual,
      source: "manual" as StatementTotalSource,
      preserved: false,
      reason: "manual_adjustment" as StatementChangeReason,
    };
  }
  if (input.calculationCompleteness === "complete" && calculated !== null) {
    return {
      displayTotalAmount: calculated,
      lastReliableTotalAmount: calculated,
      source: "complete_transaction_sum" as StatementTotalSource,
      preserved: false,
      reason: reason === "unknown" ? "complete_resync" as StatementChangeReason : reason,
    };
  }
  if (calculated !== null && baseline !== null && calculated > baseline) {
    return {
      displayTotalAmount: calculated,
      lastReliableTotalAmount: lastReliable,
      source: "partial_estimate" as StatementTotalSource,
      preserved: false,
      reason: reason === "unknown" ? "new_transaction" as StatementChangeReason : reason,
    };
  }
  if (
    calculated !== null &&
    baseline !== null &&
    calculated < baseline &&
    REDUCTION_EVIDENCE.has(reason)
  ) {
    return {
      displayTotalAmount: calculated,
      lastReliableTotalAmount: calculated,
      source: "partial_estimate" as StatementTotalSource,
      preserved: false,
      reason,
    };
  }
  if (baseline !== null) {
    return {
      displayTotalAmount: baseline,
      lastReliableTotalAmount: lastReliable ?? baseline,
      source: "reliable_snapshot" as StatementTotalSource,
      preserved: calculated !== null && calculated < baseline,
      reason: "partial_sync_preserved" as StatementChangeReason,
    };
  }
  return {
    displayTotalAmount: calculated === 0 ? null : calculated,
    lastReliableTotalAmount: null,
    source: "partial_estimate" as StatementTotalSource,
    preserved: false,
    reason,
  };
}
