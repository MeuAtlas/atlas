import { randomUUID } from "node:crypto";
import { parseInstallmentDescriptor } from "./installment-parser";
import { parseBrazilianMoney } from "./money";
import { normalizeInvoiceText, normalizeMerchant } from "./normalize-text";
import { dateToIso } from "./parser-utils";
import {
  type ExtractedPdfDocument,
  type InvoiceEntryType,
  type InvoiceValidationResult,
  type ParsedCardSection,
  type ParsedInvoiceEntry,
  type PdfTextItem,
  type PdfVisualLine,
  type SantanderInvoiceSummary,
} from "./types";
import { isDecorativeTransactionGlyph } from "./visual-layout";

type SantanderSection = "payments" | "installments" | "expenses" | null;

type ParserState = {
  activeCardLastFour: string | null;
  activeSection: SantanderSection;
  lastTransactionDate: string | null;
  lastForeignEntryId: string | null;
};

const DATE_PREFIX = /^([0-3]?\d\/[01]?\d)(?:\/(\d{2,4}))?\s+(.+)$/;
const MONEY_ONLY = /^(?:R\$\s*)?-?\d{1,3}(?:\.\d{3})*,\d{2}$/;

function moneyValues(value: string) {
  return [...value.matchAll(/(?:R\$\s*)?(-?\d{1,3}(?:\.\d{3})*,\d{2})/g)]
    .map(match => parseBrazilianMoney(match[1]))
    .filter((amount): amount is number => amount !== null);
}

function labeledMoney(lines: PdfVisualLine[], pattern: RegExp, position: "first" | "last" = "last") {
  const line = lines.find(candidate => pattern.test(candidate.text));
  if (!line) return null;
  const values = moneyValues(line.text);
  return (position === "first" ? values[0] : values.at(-1)) ?? null;
}

function valueBelowLabel(
  page: ExtractedPdfDocument["pages"][number],
  label: RegExp,
  type: "money" | "date",
) {
  const labelItem = page.items.find(item => label.test(item.text));
  if (!labelItem) return null;
  const candidates = page.items.filter(item =>
    item.y < labelItem.y && labelItem.y - item.y < 25 &&
    Math.abs(item.x - labelItem.x) < 35,
  );
  const pattern = type === "money"
    ? /(?:R\$\s*)?-?\d{1,3}(?:\.\d{3})*,\d{2}/
    : /[0-3]?\d\/[01]?\d\/\d{2,4}/;
  return candidates.map(item => item.text.match(pattern)?.[0] ?? null)
    .find((value): value is string => Boolean(value)) ?? null;
}

export function resolveInvoiceTransactionDate(
  raw: string,
  cycleEndDate: string | null,
  section: SantanderSection,
) {
  if (/\d{4}$/.test(raw)) return dateToIso(raw);
  if (!cycleEndDate) return dateToIso(raw);
  const [cycleYear, cycleMonth] = cycleEndDate.split("-").map(Number);
  const month = Number(raw.split("/")[1]);
  const year = section === "installments" && month > cycleMonth + 1
    ? cycleYear - 1
    : cycleYear;
  return dateToIso(raw, year);
}

function entryType(section: SantanderSection, description: string, amount: number): InvoiceEntryType {
  const normalized = normalizeMerchant(description);
  if (/PAGAMENTO DE FATURA|PGTO FATURA/.test(normalized)) return "payment";
  if (/\bIOF\b/.test(normalized)) return "tax";
  if (/ANUIDADE|TARIFA/.test(normalized)) return "fee";
  if (/JUROS|ENCARGO/.test(normalized)) return "interest";
  if (section === "installments") return "installment_purchase";
  if (amount < 0 && /ESTORNO|DEVOLUCAO/.test(normalized)) return "refund";
  if (amount < 0 || section === "payments") return "credit";
  return "purchase";
}

function itemMoney(item: PdfTextItem) {
  return MONEY_ONLY.test(item.text) ? parseBrazilianMoney(item.text) : null;
}

function exchangeRateFromLine(value: string) {
  const match = value.match(
    /COTA[CÇ][AÃ]O\s+D[OÓ]LAR\s+R\$\s*(\d{1,2}[.,]\d{3,6})/i,
  );
  if (!match) return null;
  const rate = Number(match[1].replace(",", "."));
  return Number.isFinite(rate) && rate > 0 ? rate : null;
}

function transactionFromLine(input: {
  line: PdfVisualLine;
  state: ParserState;
  cycleEndDate: string | null;
}): ParsedInvoiceEntry | null {
  const items = input.line.items.filter(item => !isDecorativeTransactionGlyph(item.text));
  const first = items[0];
  if (!first) return null;
  const dateMatch = first.text.match(DATE_PREFIX);
  if (!dateMatch) return null;

  const columnStart = input.line.columnIndex === 1 ? 297.5 : 0;
  const amountStart = columnStart + 190;
  const installmentStart = columnStart + 150;
  const monetaryItems = items.filter(item => item.x >= amountStart && itemMoney(item) !== null);
  const amount = monetaryItems[0] ? itemMoney(monetaryItems[0]) : null;
  if (amount === null) return null;

  const installmentItem = input.state.activeSection === "installments"
    ? items.find(item => item.x >= installmentStart && item.x < amountStart &&
      parseInstallmentDescriptor(item.text, {
        hasMoney: true,
        hasMerchant: true,
        isInstallmentColumn: true,
      }))
    : undefined;
  const installment = installmentItem
    ? parseInstallmentDescriptor(installmentItem.text, {
      hasMoney: true,
      hasMerchant: true,
      isInstallmentColumn: true,
    })
    : null;
  const descriptionParts = [
    dateMatch[3],
    ...items.slice(1).filter(item =>
      item.x < (installmentItem?.x ?? amountStart) && item.x < amountStart,
    ).map(item => item.text),
  ];
  const descriptionRaw = normalizeInvoiceText(descriptionParts.join(" "));
  const rawDate = `${dateMatch[1]}${dateMatch[2] ? `/${dateMatch[2]}` : ""}`;
  const transactionDate = resolveInvoiceTransactionDate(
    rawDate,
    input.cycleEndDate,
    input.state.activeSection,
  );
  input.state.lastTransactionDate = transactionDate;
  const type = entryType(input.state.activeSection, descriptionRaw, amount);
  const signedAmount = ["payment", "credit", "refund"].includes(type)
    ? -Math.abs(amount)
    : Math.abs(amount);
  const foreignAmount = monetaryItems[1] ? itemMoney(monetaryItems[1]) : null;
  const id = randomUUID();
  input.state.lastForeignEntryId = foreignAmount === null ? null : id;
  return {
    id,
    transactionDate,
    postingDate: null,
    descriptionRaw,
    descriptionNormalized: normalizeInvoiceText(descriptionRaw),
    merchantNormalized: normalizeMerchant(descriptionRaw),
    amountCents: signedAmount,
    currencyCode: "BRL",
    entryType: type,
    cardLastFour: input.state.activeCardLastFour,
    installment,
    confidence: installment ? .97 : transactionDate ? .93 : .72,
    reviewStatus: "pending",
    isIgnored: false,
    sourceLineNumber: input.line.pageNumber * 10_000 + Math.round(input.line.y),
    foreignAmountCents: foreignAmount === null ? null : Math.abs(foreignAmount),
    foreignCurrencyCode: foreignAmount === null ? null : "USD",
    exchangeRate: null,
    iofAmountCents: null,
    relatedForeignEntryId: null,
  };
}

function continuationEntry(input: {
  line: PdfVisualLine;
  state: ParserState;
}): ParsedInvoiceEntry | null {
  const normalized = normalizeMerchant(input.line.text);
  if (/COTACAO|VALOR TOTAL|TOTAL DESPESAS/.test(normalized)) return null;
  if (!/\bIOF\b/.test(normalized)) return null;
  const amount = moneyValues(input.line.text).at(-1);
  if (amount === undefined) return null;
  const descriptionRaw = normalizeInvoiceText(
    input.line.items.filter(item => !MONEY_ONLY.test(item.text))
      .map(item => item.text).join(" "),
  );
  return {
    id: randomUUID(),
    transactionDate: input.state.lastTransactionDate,
    postingDate: null,
    descriptionRaw,
    descriptionNormalized: descriptionRaw,
    merchantNormalized: normalizeMerchant(descriptionRaw),
    amountCents: Math.abs(amount),
    currencyCode: "BRL",
    entryType: "tax",
    cardLastFour: input.state.activeCardLastFour,
    installment: null,
    confidence: .9,
    reviewStatus: "pending",
    isIgnored: false,
    sourceLineNumber: input.line.pageNumber * 10_000 + Math.round(input.line.y),
    relatedForeignEntryId: input.state.lastForeignEntryId,
  };
}

function parsePeriodLines(document: ExtractedPdfDocument) {
  const matches = [...document.fullText.matchAll(
    /([0-3]?\d\/[01]?\d\/\d{2,4})\s+a\s+([0-3]?\d\/[01]?\d\/\d{2,4})/gi,
  )];
  return matches.map(match => ({
    start: dateToIso(match[1]),
    end: dateToIso(match[2]),
  })).filter(period => period.start && period.end);
}

function parseSummary(lines: PdfVisualLine[]): SantanderInvoiceSummary {
  return {
    previousBalanceCents: labeledMoney(lines, /^Saldo Anterior/i),
    domesticDebitsCents: labeledMoney(lines, /Total Despesas\/Débitos no Brasil/i),
    foreignDebitsCents: labeledMoney(lines, /Total Despesas\/Débitos no Exterior/i, "first"),
    paymentsCents: labeledMoney(lines, /Total de pagamentos/i),
    creditsCents: labeledMoney(lines, /Total de créditos/i),
    finalBalanceCents: labeledMoney(lines, /Saldo Desta Fatura/i),
  };
}

export function parseSantanderVisualDocument(document: ExtractedPdfDocument) {
  const firstPage = document.pages[0];
  const totalRaw = valueBelowLabel(firstPage, /^Total a Pagar$/i, "money");
  const dueRaw = valueBelowLabel(firstPage, /^Vencimento$/i, "date");
  const officialTotalCents = totalRaw ? parseBrazilianMoney(totalRaw) : null;
  const dueDate = dueRaw ? dateToIso(dueRaw) : null;
  const periods = parsePeriodLines(document);
  const currentPeriod = periods.find(period => period.end && dueDate &&
    period.end.slice(0, 7) === dueDate.slice(0, 7)) ?? periods[0] ?? null;
  const nextPeriod = periods.find(period => period.start &&
    currentPeriod?.end && period.start > currentPeriod.end) ?? null;
  const cycleStartDate = currentPeriod?.start ?? null;
  const cycleEndDate = currentPeriod?.end ?? null;

  const state: ParserState = {
    activeCardLastFour: null,
    activeSection: null,
    lastTransactionDate: null,
    lastForeignEntryId: null,
  };
  const entries: ParsedInvoiceEntry[] = [];
  const cardMap = new Map<string, ParsedCardSection>();
  const transactionLines = document.pages
    .filter(page => page.pageNumber === 2 || page.pageNumber === 3)
    .flatMap(page => [...page.visualLines].sort((a, b) =>
      a.columnIndex - b.columnIndex || b.y - a.y,
    ));

  for (const line of transactionLines) {
    const cardMatch = line.text.match(/X{2,}\s*(\d{4})\s*$/i);
    if (cardMatch) {
      state.activeCardLastFour = cardMatch[1];
      state.activeSection = null;
      state.lastForeignEntryId = null;
      if (!cardMap.has(cardMatch[1])) {
        cardMap.set(cardMatch[1], {
          cardLastFour: cardMatch[1],
          holderName: null,
          subtotalBRLCents: null,
          subtotalForeignCents: null,
          entriesCount: 0,
          installmentCount: 0,
        });
      }
      continue;
    }
    if (/^Pagamento e Demais Créditos/i.test(line.text)) {
      state.activeSection = "payments";
      continue;
    }
    if (/^Parcelamentos$/i.test(line.text)) {
      state.activeSection = "installments";
      continue;
    }
    if (/^Despesas$/i.test(line.text)) {
      state.activeSection = "expenses";
      continue;
    }
    if (/^Resumo da Fatura|^Saldo total consolidado/i.test(line.text)) {
      state.activeSection = null;
      continue;
    }
    if (/^VALOR TOTAL/i.test(line.text) && state.activeCardLastFour) {
      const amounts = moneyValues(line.text);
      const section = cardMap.get(state.activeCardLastFour);
      if (section) {
        section.subtotalBRLCents = amounts[0] ?? null;
        section.subtotalForeignCents = amounts[1] ?? null;
      }
      continue;
    }
    if (!state.activeSection || !state.activeCardLastFour) continue;
    const exchangeRate = exchangeRateFromLine(line.text);
    if (exchangeRate !== null && state.lastForeignEntryId) {
      const foreignEntry = entries.find(entry =>
        entry.id === state.lastForeignEntryId);
      if (foreignEntry) foreignEntry.exchangeRate = exchangeRate;
      continue;
    }
    const entry = transactionFromLine({ line, state, cycleEndDate })
      ?? continuationEntry({ line, state });
    if (entry) {
      entries.push(entry);
      if (
        entry.entryType === "tax" &&
        entry.relatedForeignEntryId
      ) {
        const foreignEntry = entries.find(candidate =>
          candidate.id === entry.relatedForeignEntryId);
        if (foreignEntry) {
          foreignEntry.iofAmountCents =
            (foreignEntry.iofAmountCents ?? 0) + Math.abs(entry.amountCents);
        }
      }
    }
  }

  for (const section of cardMap.values()) {
    const sectionEntries = entries.filter(entry => entry.cardLastFour === section.cardLastFour);
    section.entriesCount = sectionEntries.length;
    section.installmentCount = sectionEntries.filter(entry => entry.installment).length;
  }

  const pageThreeLines = document.pages[2]?.visualLines ?? [];
  const summary = parseSummary(pageThreeLines);
  const providerFutureInstallmentBalanceCents =
    labeledMoney(pageThreeLines, /Compras parceladas com e sem juros/i);
  const minimumPaymentCents = labeledMoney(firstPage.visualLines, /Pagamento Mínimo/i);
  const nextOpenLine = firstPage.visualLines.find(line => /Fatura Aberta/i.test(line.text));
  const nextOpenInvoiceAmountCents = nextOpenLine
    ? moneyValues(nextOpenLine.text)[0] ?? null
    : null;
  const subtotals = [...cardMap.values()].reduce(
    (sum, section) => sum + (section.subtotalBRLCents ?? 0),
    0,
  );
  const signedEntries = entries.reduce((sum, entry) => sum + entry.amountCents, 0);
  const reconstructedWithPreviousBalance =
    signedEntries + (summary.previousBalanceCents ?? 0);
  const summaryCalculated = (summary.previousBalanceCents ?? 0)
    + (summary.domesticDebitsCents ?? 0)
    + (summary.foreignDebitsCents ?? 0)
    - (summary.paymentsCents ?? 0)
    - (summary.creditsCents ?? 0);
  const futureProjected = entries.filter(entry => entry.installment)
    .reduce((sum, entry) =>
      sum + Math.abs(entry.amountCents) *
      Math.max(0, entry.installment!.total - entry.installment!.current), 0);
  const validation: InvoiceValidationResult = {
    officialTotalMatchesSummary:
      Math.abs((officialTotalCents ?? 0) - (summary.finalBalanceCents ?? 0)) <= 1,
    cardSubtotalsMatchOfficialTotal:
      Math.abs((officialTotalCents ?? 0) - subtotals) <= 1,
    reconstructedEntriesMatchSubtotals:
      Math.abs(subtotals - reconstructedWithPreviousBalance) <= 1,
    futureProjectionMatchesProviderBalance: providerFutureInstallmentBalanceCents === null
      ? null
      : Math.abs(providerFutureInstallmentBalanceCents - futureProjected) <= 1,
    summaryDifferenceCents: (officialTotalCents ?? 0) - summaryCalculated,
    cardSubtotalDifferenceCents: (officialTotalCents ?? 0) - subtotals,
    entryDifferenceCents: subtotals - reconstructedWithPreviousBalance,
    futureProjectionDifferenceCents: providerFutureInstallmentBalanceCents === null
      ? null
      : providerFutureInstallmentBalanceCents - futureProjected,
  };

  return {
    officialTotalCents,
    dueDate,
    cycleStartDate,
    cycleEndDate,
    closingDate: cycleEndDate,
    minimumPaymentCents,
    nextOpenInvoiceAmountCents,
    nextCycleStartDate: nextPeriod?.start ?? null,
    nextCycleEndDate: nextPeriod?.end ?? null,
    providerFutureInstallmentBalanceCents,
    previousBalanceCents: summary.previousBalanceCents,
    entries,
    cardSections: [...cardMap.values()],
    summary,
    validation,
  };
}
