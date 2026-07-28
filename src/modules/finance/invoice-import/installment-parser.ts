import type { ParsedInstallment } from "./types";

const patterns = [
  /\bP(?:ARC(?:ELA)?)?\s*0?(\d{1,3})\s*\/\s*0?(\d{1,3})\b/i,
  /\bPARCELA\s+0?(\d{1,3})\s+DE\s+0?(\d{1,3})\b/i,
  /\b0?(\d{1,3})\s+DE\s+0?(\d{1,3})\b/i,
  /\b0?(\d{1,3})\s*[-X]\s*0?(\d{1,3})\b/i,
  /\b0?(\d{1,3})\s*\/\s*0?(\d{1,3})\b/i,
];

export function parseInstallmentDescriptor(
  value: string,
  context: { hasMoney?: boolean; hasMerchant?: boolean; isInstallmentColumn?: boolean } = {},
): ParsedInstallment | null {
  for (const pattern of patterns) {
    const match = value.match(pattern);
    if (!match) continue;
    const current = Number(match[1]);
    const total = Number(match[2]);
    if (current < 1 || total < current || total > 120 || total < 2) continue;
    const raw = match[0];
    const dateLike = /^(?:0?[1-9]|[12]\d|3[01])\/(?:0?[1-9]|1[0-2])$/.test(raw.trim());
    if (dateLike && !context.isInstallmentColumn && !/\b(?:PARC|PARCELA|P)\b/i.test(raw)) continue;
    if (/\b(?:CARTAO|FINAL)\s*\*?\s*$/.test(value.slice(0, match.index))) continue;
    const confidence = Math.min(0.99,
      0.68 + (context.hasMoney ? 0.14 : 0) + (context.hasMerchant ? 0.12 : 0) +
      (/(?:PARC|PARCELA|\bP)/i.test(raw) ? 0.05 : 0));
    return { current, total, raw, confidence };
  }
  return null;
}
