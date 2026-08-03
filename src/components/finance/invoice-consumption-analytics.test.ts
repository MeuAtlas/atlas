import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { InvoiceConsumptionAnalytics } from "./invoice-consumption-analytics";
import { buildInvoiceHistoryAnalytics } from "@/modules/finance/invoice-history";

test("renderiza a fatura aberta no mês de pagamento sem categoria Atual", () => {
  const analytics = buildInvoiceHistoryAnalytics([
    {
      id: "july", cardId: "mc", dueDate: "2026-07-10", status: "paid",
      total: 11517.22, totalSource: "provider_bill", paidAmount: 11517.22,
      paymentDate: "2026-07-10", paymentConfirmationStatus: "paid", isConfirmed: true,
    },
    {
      id: "august", cardId: "mc", dueDate: "2026-08-10", status: "open",
      total: 7669.72, totalSource: "provider_bill", cycleStartDate: "2026-07-04",
      cycleEndDate: "2026-08-03", closingDate: "2026-08-03",
      paymentConfirmationStatus: "open", isConfirmed: false,
    },
  ], null);
  const html = renderToStaticMarkup(InvoiceConsumptionAnalytics({ analytics }));

  assert.match(html, /Fatura de agosto de 2026/);
  assert.match(html, /ago\/2026/);
  assert.match(html, /R\$[^<]*7\.669,72/);
  assert.match(html, /Ciclo de compras/);
  assert.match(html, /class="open"/);
  assert.doesNotMatch(html, />Atual</);
  assert.doesNotMatch(html, /R\$[^<]*0,00/);
});

test("após o pagamento mantém agosto azul e posiciona a abertura em setembro", () => {
  const analytics = buildInvoiceHistoryAnalytics([
    {
      id: "august", cardId: "mc", dueDate: "2026-08-10", status: "paid",
      total: 7669.72, totalSource: "provider_bill", paidAmount: 7702.14,
      paymentDate: "2026-08-10", paymentConfirmationStatus: "paid", isConfirmed: true,
    },
    {
      id: "september", cardId: "mc", dueDate: "2026-09-10", status: "open",
      total: 1610.5, totalSource: "calculated_transactions", closingDate: "2026-09-03",
      paymentConfirmationStatus: "open", isConfirmed: false,
    },
  ], null);
  const html = renderToStaticMarkup(InvoiceConsumptionAnalytics({ analytics }));

  assert.match(html, /class="paid"/);
  assert.match(html, /ago\/2026/);
  assert.match(html, /class="open"/);
  assert.match(html, /set\/2026/);
  assert.match(html, /Pagamento\s*<em>10\/08\/2026<\/em>/);
});
