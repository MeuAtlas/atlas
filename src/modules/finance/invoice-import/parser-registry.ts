import { GenericInvoiceParser } from "./parsers/generic";
import { SantanderInvoiceParser } from "./parsers/santander";
import type { ExtractedPdfDocument, InvoiceParser, ParsedInvoice } from "./types";

const parsers: InvoiceParser[] = [new SantanderInvoiceParser(), new GenericInvoiceParser()];

export function parseInvoiceDocument(
  document: ExtractedPdfDocument,
  context?: { referenceYear?: number },
): ParsedInvoice {
  const parser = [...parsers]
    .map(item => ({ item, score: item.canParse(document) }))
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score || b.item.priority - a.item.priority)[0]?.item;
  if (!parser) throw new Error("invoice_parser_not_found");
  const result = parser.parse(document, context);
  result.warnings.push(...parser.validate(result).map(code => `Revisão necessária: ${code}.`));
  return result;
}
