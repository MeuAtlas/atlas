export function parseBrazilianMoney(raw: string): number | null {
  const compact = raw.replace(/\s/g, "").replace(/R\$/gi, "");
  const negative = compact.startsWith("-") || /^\(.*\)$/.test(compact);
  const cleaned = compact.replace(/[()\-+]/g, "");
  if (!/^\d{1,3}(?:\.\d{3})*(?:,\d{2})$|^\d+(?:,\d{2})$/.test(cleaned)) return null;
  const normalized = cleaned.replace(/\./g, "").replace(",", ".");
  const value = Number(normalized);
  return Number.isFinite(value) ? Math.round(value * 100) * (negative ? -1 : 1) : null;
}

export const centsToDecimal = (cents: number) => Number((cents / 100).toFixed(2));

export const formatCents = (cents: number, currency = "BRL") =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(cents / 100);
