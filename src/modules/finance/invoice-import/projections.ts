import type { FutureCardCommitment, InstallmentProjection } from "./types";

const monthStart = (date: string) => `${date.slice(0, 7)}-01`;
const safeDay = (year: number, monthIndex: number, day: number) =>
  Math.min(day, new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate());

export function projectInstallmentOccurrences(input: {
  dueDate: string;
  currentInstallment: number;
  totalInstallments: number;
  amountCents: number;
  dueDay?: number;
}): InstallmentProjection[] {
  if (input.currentInstallment < 1 || input.totalInstallments < input.currentInstallment) return [];
  const [year, month, day] = input.dueDate.split("-").map(Number);
  const dueDay = input.dueDay ?? day;
  return Array.from(
    { length: input.totalInstallments - input.currentInstallment + 1 },
    (_, index) => {
      const date = new Date(Date.UTC(year, month - 1 + index, 1));
      const due = new Date(Date.UTC(
        date.getUTCFullYear(), date.getUTCMonth(),
        safeDay(date.getUTCFullYear(), date.getUTCMonth(), dueDay),
      ));
      return {
        competenceMonth: monthStart(due.toISOString().slice(0, 10)),
        installmentNumber: input.currentInstallment + index,
        totalInstallments: input.totalInstallments,
        amountCents: Math.abs(input.amountCents),
        dueDate: due.toISOString().slice(0, 10),
        status: index === 0 ? "posted" : "projected",
      };
    },
  );
}

export function calculateFutureCardCommitments(
  occurrences: Array<{ competenceMonth: string; amountCents: number; status: string; confidence: number }>,
): FutureCardCommitment[] {
  const grouped = new Map<string, FutureCardCommitment>();
  for (const item of occurrences) {
    if (!["projected", "confirmed"].includes(item.status)) continue;
    const month = monthStart(item.competenceMonth);
    const current = grouped.get(month) ?? {
      competenceMonth: month, installmentCommitmentsCents: 0,
      recurringCommitmentsCents: 0, otherKnownCommitmentsCents: 0,
      totalCommittedCents: 0, sourceCount: 0, confidence: 1,
    };
    current.installmentCommitmentsCents += item.amountCents;
    current.totalCommittedCents += item.amountCents;
    current.sourceCount += 1;
    current.confidence = Math.min(current.confidence, item.confidence);
    grouped.set(month, current);
  }
  return [...grouped.values()].sort((a, b) => a.competenceMonth.localeCompare(b.competenceMonth));
}
