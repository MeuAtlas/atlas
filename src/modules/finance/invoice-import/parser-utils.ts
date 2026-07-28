import { randomUUID } from "node:crypto";
import { parseInstallmentDescriptor } from "./installment-parser";
import { parseBrazilianMoney } from "./money";
import { normalizeInvoiceText, normalizeMerchant } from "./normalize-text";
import type { ExtractedPdfDocument, InvoiceEntryType, ParsedInvoiceEntry } from "./types";

export const DATE_RE = /\b([0-3]?\d)\/([01]?\d)(?:\/(\d{2}|\d{4}))?\b/;
export const MONEY_RE = /(?:R\$\s*)?-?\d{1,3}(?:\.\d{3})*,\d{2}|(?:R\$\s*)?-?\d+,\d{2}/g;

export function dateToIso(raw: string, referenceYear = new Date().getFullYear()) {
  const match = raw.match(DATE_RE);
  if (!match) return null;
  const day = Number(match[1]);
  const month = Number(match[2]);
  let year = match[3] ? Number(match[3]) : referenceYear;
  if (year < 100) year += 2000;
  const value = new Date(Date.UTC(year, month - 1, day));
  if (value.getUTCFullYear() !== year || value.getUTCMonth() !== month - 1 || value.getUTCDate() !== day) return null;
  return value.toISOString().slice(0, 10);
}

export function classifyEntry(text: string, section = ""): InvoiceEntryType {
  const normalized = normalizeMerchant(`${section} ${text}`);
  if (/PAGAMENTO|PGTO FATURA/.test(normalized)) return "payment";
  if (/ESTORNO|DEVOLUCAO/.test(normalized)) return "refund";
  if (/CREDITO|CREDITO ROTATIVO/.test(normalized) && !/COMPRA/.test(normalized)) return "credit";
  if (/\bIOF\b/.test(normalized)) return "tax";
  if (/JUROS|ENCARGO|ROTATIVO/.test(normalized)) return "interest";
  if (/TARIFA|ANUIDADE/.test(normalized)) return "fee";
  if (/SALDO ANTERIOR/.test(normalized)) return "previous_balance";
  return parseInstallmentDescriptor(text, { hasMoney: true, hasMerchant: true })
    ? "installment_purchase" : "purchase";
}

function isNoise(text: string) {
  const normalized = normalizeMerchant(text);
  return /LIMITE DISPONIVEL|PAGAMENTO MINIMO|CODIGO DE BARRAS|PARCELE SUA FATURA|MELHOR DATA|TAXA AO MES|CET|CENTRAL DE ATENDIMENTO|SAC|OUVIDORIA/.test(normalized);
}

export function extractEntryCandidates(
  document: ExtractedPdfDocument,
  referenceYear?: number,
): ParsedInvoiceEntry[] {
  const all = document.pages.flatMap(page =>
    page.lines.map((text, index) => ({ text: normalizeInvoiceText(text), line: page.pageNumber * 10000 + index + 1 })),
  ).filter(item => item.text);
  const results: ParsedInvoiceEntry[] = [];
  for (let index = 0; index < all.length; index += 1) {
    const start = all[index];
    if (!DATE_RE.test(start.text)) continue;
    const block = [start.text];
    for (let next = index + 1; next < Math.min(all.length, index + 4); next += 1) {
      if (DATE_RE.test(all[next].text) && MONEY_RE.test(all[next].text)) break;
      block.push(all[next].text);
      MONEY_RE.lastIndex = 0;
      if (MONEY_RE.test(all[next].text)) break;
    }
    const joined = block.join(" ");
    MONEY_RE.lastIndex = 0;
    const moneyMatches = [...joined.matchAll(MONEY_RE)];
    const lastMoney = moneyMatches.at(-1);
    if (!lastMoney || isNoise(joined)) continue;
    const amountCents = parseBrazilianMoney(lastMoney[0]);
    if (amountCents === null) continue;
    const dateRaw = joined.match(DATE_RE)?.[0] ?? "";
    const transactionDate = dateToIso(dateRaw, referenceYear);
    if (!transactionDate) continue;
    const descriptionRaw = joined
      .replace(DATE_RE, " ")
      .replace(lastMoney[0], " ")
      .replace(/\s+/g, " ").trim();
    if (descriptionRaw.length < 2) continue;
    const installment = parseInstallmentDescriptor(joined, { hasMoney: true, hasMerchant: true });
    const entryType = classifyEntry(descriptionRaw);
    const signedAmount = ["credit", "refund", "payment"].includes(entryType)
      ? -Math.abs(amountCents) : Math.abs(amountCents);
    results.push({
      id: randomUUID(), transactionDate, postingDate: null, descriptionRaw,
      descriptionNormalized: normalizeInvoiceText(descriptionRaw),
      merchantNormalized: normalizeMerchant(descriptionRaw),
      amountCents: signedAmount, currencyCode: "BRL", entryType,
      cardLastFour: joined.match(/(?:FINAL|CART[AÃ]O)\s*\*?(\d{4})/i)?.[1] ?? null,
      installment, confidence: installment ? Math.min(.94, installment.confidence) : .82,
      reviewStatus: "pending", isIgnored: false, sourceLineNumber: start.line,
    });
    index += block.length - 1;
  }
  return results;
}

export function findLabeledMoney(text: string, labels: RegExp[]) {
  for (const label of labels) {
    const match = text.match(new RegExp(`${label.source}[\\s\\S]{0,60}?((?:R\\$\\s*)?-?\\d{1,3}(?:\\.\\d{3})*,\\d{2}|(?:R\\$\\s*)?-?\\d+,\\d{2})`, "i"));
    if (match) return parseBrazilianMoney(match[1]);
  }
  return null;
}

export function findLabeledDate(text: string, labels: RegExp[], referenceYear?: number) {
  for (const label of labels) {
    const match = text.match(new RegExp(`${label.source}[\\s:.-]{0,20}(${DATE_RE.source})`, "i"));
    if (match) return dateToIso(match[1], referenceYear);
  }
  return null;
}
