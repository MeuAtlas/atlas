import type { PluggyTransaction } from "./types";

export const ATLAS_FINANCE_TIME_ZONE = "America/Sao_Paulo";

export type NormalizedProviderTransactionDate = {
  providerDate: string;
  providerPostedAt: string;
  bankPostedAt: string;
  effectiveAt: string | null;
  localDate: string;
  dateSource: "provider_posted" | "provider_effective";
  dateConfidence: "high" | "medium";
};

function isoTimestamp(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? null : parsed.toISOString();
}

export function localDateInTimeZone(timestamp: string, timeZone = ATLAS_FINANCE_TIME_ZONE) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(timestamp));
  const values = Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  return `${values.year}-${values.month}-${values.day}`;
}

function effectiveTimestamp(transaction: PluggyTransaction) {
  const paymentData =
    transaction.paymentData &&
    typeof transaction.paymentData === "object" &&
    !Array.isArray(transaction.paymentData)
      ? transaction.paymentData
      : {};
  return (
    isoTimestamp(transaction.effectiveDate) ??
    isoTimestamp(transaction.settlementDate) ??
    isoTimestamp(paymentData.effectiveDate) ??
    isoTimestamp(paymentData.settlementDate) ??
    isoTimestamp(paymentData.availableAt)
  );
}

export function normalizeProviderTransactionDate(
  transaction: Pick<
    PluggyTransaction,
    "date" | "effectiveDate" | "settlementDate" | "paymentData"
  >,
  timeZone = ATLAS_FINANCE_TIME_ZONE,
): NormalizedProviderTransactionDate {
  const raw =
    typeof transaction.date === "string" && transaction.date.trim()
      ? transaction.date.trim()
      : new Date().toISOString();
  const providerPostedAt = isoTimestamp(raw) ?? new Date().toISOString();
  const effectiveAt = effectiveTimestamp(transaction as PluggyTransaction);
  const bankPostedAt = effectiveAt ?? providerPostedAt;
  return {
    providerDate: raw,
    providerPostedAt,
    bankPostedAt,
    effectiveAt,
    localDate: localDateInTimeZone(bankPostedAt, timeZone),
    dateSource: effectiveAt ? "provider_effective" : "provider_posted",
    dateConfidence: effectiveAt ? "high" : "medium",
  };
}
