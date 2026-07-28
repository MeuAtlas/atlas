import { extractEntryCandidates, findLabeledDate, findLabeledMoney } from "../parser-utils";
import type { ExtractedPdfDocument, InvoiceParser, ParsedInvoice } from "../types";

export class GenericInvoiceParser implements InvoiceParser {
  readonly name = "generic";
  readonly version = "1.0.0";
  readonly priority = 1;
  canParse(document: ExtractedPdfDocument) { return document.fullText.trim() ? .25 : 0; }
  parse(document: ExtractedPdfDocument, context?: { referenceYear?: number }): ParsedInvoice {
    const text = document.fullText;
    const entries = extractEntryCandidates(document, context?.referenceYear);
    const officialTotalCents = findLabeledMoney(text, [/TOTAL\s+(?:DA\s+)?FATURA/i, /TOTAL\s+A\s+PAGAR/i]);
    const dueDate = findLabeledDate(text, [/VENCIMENTO/i, /VENCE\s+EM/i], context?.referenceYear);
    const closingDate = findLabeledDate(text, [/FECHAMENTO/i, /FECHOU\s+EM/i], context?.referenceYear);
    const warnings = [];
    if (officialTotalCents === null) warnings.push("O total oficial não foi identificado.");
    if (!dueDate) warnings.push("A data de vencimento não foi identificada.");
    if (!entries.length) warnings.push("Nenhum lançamento foi identificado automaticamente.");
    return {
      bankCode: null, bankName: null, parserName: this.name, parserVersion: this.version,
      cardLastFour: text.match(/(?:FINAL|CART[AÃ]O)\s*\*?(\d{4})/i)?.[1] ?? null,
      cycleStartDate: null, cycleEndDate: closingDate, closingDate, dueDate,
      officialTotalCents, previousBalanceCents: findLabeledMoney(text, [/SALDO\s+ANTERIOR/i]),
      currencyCode: "BRL", entries, confidence: Math.min(.74,
        .3 + (officialTotalCents !== null ? .15 : 0) + (dueDate ? .1 : 0) + (entries.length ? .1 : 0)),
      fieldConfidence: {
        officialTotal: officialTotalCents === null ? 0 : .78,
        dueDate: dueDate ? .76 : 0, closingDate: closingDate ? .72 : 0,
      },
      warnings, pageCount: document.pageCount,
    };
  }
  validate(result: ParsedInvoice) {
    return [
      ...(result.officialTotalCents === null ? ["missing_total"] : []),
      ...(!result.dueDate ? ["missing_due_date"] : []),
    ];
  }
}
