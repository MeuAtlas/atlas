export type PersonalDeductionVersion = {
  id: string;
  deductionGroupId: string;
  name: string;
  amountMinorUnits: number;
  deductibleFromIrrfBase: boolean;
  effectiveFrom: string;
  effectiveTo: string | null;
  notes: string | null;
};

export function competenceStart(year: number, month: number) {
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) throw new Error("Competência inválida.");
  return `${year}-${String(month).padStart(2, "0")}-01`;
}

export function appliesToCompetence(item: Pick<PersonalDeductionVersion, "effectiveFrom" | "effectiveTo">, competence: string) {
  return item.effectiveFrom <= competence && (item.effectiveTo === null || item.effectiveTo >= competence);
}

export function previousMonthEnd(competence: string) {
  const date = new Date(`${competence}T12:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.getUTCDate() !== 1) throw new Error("Competência inválida.");
  date.setUTCDate(0);
  return date.toISOString().slice(0, 10);
}

export function parseBrlToCents(value: string) {
  const compact = value.trim().replace(/\s/g, "").replace(/^R\$/i, "");
  if (!compact) return null;
  const decimalSeparator = compact.includes(",") ? "," : compact.includes(".") ? "." : null;
  const normalized = decimalSeparator === ","
    ? compact.replace(/\./g, "").replace(",", ".")
    : compact;
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return null;
  const cents = Math.round(Number(normalized) * 100);
  return Number.isSafeInteger(cents) ? cents : null;
}
