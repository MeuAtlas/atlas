import { createHash } from "node:crypto";
import { normalizeMerchant } from "./normalize-text";

export function buildInstallmentFingerprint(input: {
  workspaceId: string;
  cardId: string;
  cardLastFour?: string | null;
  merchant: string;
  amountCents: number;
  totalInstallments: number;
  currencyCode?: string;
}) {
  const identity = [
    input.workspaceId, input.cardId, input.cardLastFour ?? "",
    normalizeMerchant(input.merchant), Math.abs(input.amountCents),
    input.totalInstallments, input.currencyCode ?? "BRL",
  ].join("|");
  return createHash("sha256").update(identity).digest("hex");
}

export function scoreInstallmentMatch(candidate: {
  cardId: string; merchantNormalized: string; installmentAmountCents: number;
  totalInstallments: number; latestKnownInstallment: number; lastCompetence: string;
}, incoming: {
  cardId: string; merchantNormalized: string; installmentAmountCents: number;
  totalInstallments: number; currentInstallment: number; competenceMonth: string;
}) {
  if (candidate.cardId !== incoming.cardId) return 0;
  let score = .25;
  if (candidate.installmentAmountCents === incoming.installmentAmountCents) score += .25;
  if (candidate.totalInstallments === incoming.totalInstallments) score += .2;
  if (normalizeMerchant(candidate.merchantNormalized) === normalizeMerchant(incoming.merchantNormalized)) score += .2;
  if (incoming.currentInstallment === candidate.latestKnownInstallment + 1) score += .05;
  const expected = addMonths(candidate.lastCompetence, 1);
  if (expected === incoming.competenceMonth) score += .05;
  return Number(Math.min(1, score).toFixed(2));
}

function addMonths(month: string, amount: number) {
  const [year, rawMonth] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, rawMonth - 1 + amount, 1));
  return date.toISOString().slice(0, 10);
}
