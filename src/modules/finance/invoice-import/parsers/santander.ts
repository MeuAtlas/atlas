import { parseSantanderVisualDocument } from "../santander-visual-parser";
import type { ExtractedPdfDocument, InvoiceParser, ParsedInvoice } from "../types";

export class SantanderInvoiceParser implements InvoiceParser {
  readonly name = "santander";
  readonly version = "2.1.0";
  readonly priority = 100;

  canParse(document: ExtractedPdfDocument) {
    const text = document.fullText.toLocaleUpperCase("pt-BR");
    const signals = [
      /SANTANDER/.test(text),
      /DETALHAMENTO DA FATURA/.test(text),
      /RESUMO DA FATURA/.test(text),
      /SALDO DESTA FATURA/.test(text),
    ].filter(Boolean).length;
    return signals >= 3 ? .99 : signals >= 1 ? .8 : 0;
  }

  parse(document: ExtractedPdfDocument): ParsedInvoice {
    const visual = parseSantanderVisualDocument(document);
    const warnings: string[] = [];
    if (visual.officialTotalCents === null) warnings.push("O total oficial não foi identificado.");
    if (!visual.dueDate) warnings.push("A data de vencimento não foi identificada.");
    if (!visual.cycleEndDate) warnings.push("O ciclo da fatura não foi identificado.");
    if (!visual.entries.length) warnings.push("Nenhum lançamento foi identificado automaticamente.");
    if (!visual.validation.reconstructedEntriesMatchSubtotals) {
      warnings.push("Os lançamentos reconstruídos diferem dos subtotais dos cartões. Revise as linhas sinalizadas.");
    }
    if (visual.validation.futureProjectionMatchesProviderBalance === false) {
      warnings.push("As projeções identificadas diferem do saldo futuro informado pelo Santander.");
    }
    const cardLastFour = visual.cardSections[0]?.cardLastFour ?? null;
    const confidence = Math.min(.99,
      .55 + (visual.officialTotalCents !== null ? .12 : 0)
      + (visual.dueDate ? .08 : 0)
      + (visual.cycleEndDate ? .07 : 0)
      + (visual.cardSections.length >= 2 ? .07 : 0)
      + (visual.entries.length ? .05 : 0)
      + (visual.validation.officialTotalMatchesSummary ? .03 : 0)
      + (visual.validation.cardSubtotalsMatchOfficialTotal ? .02 : 0));
    return {
      bankCode: "033",
      bankName: "Santander",
      parserName: this.name,
      parserVersion: this.version,
      cardLastFour,
      cycleStartDate: visual.cycleStartDate,
      cycleEndDate: visual.cycleEndDate,
      closingDate: visual.closingDate,
      dueDate: visual.dueDate,
      officialTotalCents: visual.officialTotalCents,
      previousBalanceCents: visual.previousBalanceCents,
      currencyCode: "BRL",
      entries: visual.entries,
      confidence,
      fieldConfidence: {
        bank: .99,
        officialTotal: visual.officialTotalCents === null ? 0 : .99,
        dueDate: visual.dueDate ? .99 : 0,
        cycle: visual.cycleEndDate ? .98 : 0,
        cards: visual.cardSections.length >= 2 ? .98 : .6,
      },
      warnings,
      pageCount: document.pageCount,
      minimumPaymentCents: visual.minimumPaymentCents,
      nextOpenInvoiceAmountCents: visual.nextOpenInvoiceAmountCents,
      nextCycleStartDate: visual.nextCycleStartDate,
      nextCycleEndDate: visual.nextCycleEndDate,
      providerFutureInstallmentBalanceCents: visual.providerFutureInstallmentBalanceCents,
      cardSections: visual.cardSections,
      santanderSummary: visual.summary,
      validation: visual.validation,
    };
  }

  validate(result: ParsedInvoice) {
    return [
      ...(result.officialTotalCents === null ? ["missing_total"] : []),
      ...(!result.dueDate ? ["missing_due_date"] : []),
      ...(result.entries.length === 0 ? ["missing_entries"] : []),
    ];
  }
}
