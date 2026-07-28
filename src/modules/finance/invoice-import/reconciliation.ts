import type { InvoiceReconciliation, ParsedInvoiceEntry } from "./types";

const sum = (entries: ParsedInvoiceEntry[], types: ParsedInvoiceEntry["entryType"][]) =>
  entries.filter(e => !e.isIgnored && types.includes(e.entryType)).reduce((total, e) => total + Math.abs(e.amountCents), 0);

export function reconcileInvoice(input: {
  officialTotalCents: number | null;
  previousBalanceCents?: number | null;
  entries: ParsedInvoiceEntry[];
}): InvoiceReconciliation {
  const purchasesCents = sum(input.entries, ["purchase", "installment_purchase"]);
  const creditsCents = sum(input.entries, ["credit", "refund"]);
  const paymentsCents = sum(input.entries, ["payment"]);
  const financeChargesCents = sum(input.entries, ["fee", "interest", "tax"]);
  const previousBalanceCents = Math.abs(input.previousBalanceCents ?? 0);
  const reconstructedTotalCents =
    previousBalanceCents + purchasesCents + financeChargesCents - creditsCents - paymentsCents;
  const differenceCents = input.officialTotalCents === null
    ? null : input.officialTotalCents - reconstructedTotalCents;
  return {
    officialTotalCents: input.officialTotalCents, purchasesCents, creditsCents,
    paymentsCents, financeChargesCents, previousBalanceCents,
    reconstructedTotalCents, differenceCents,
    status: differenceCents === null ? "unavailable" : Math.abs(differenceCents) <= 1 ? "matched" : "different",
  };
}
