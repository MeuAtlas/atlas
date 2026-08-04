import assert from "node:assert/strict";
import test from "node:test";
import { buildResolvedCardCycleDetails } from "./resolved-card-cycle-details";
import type { AvailableCardCycle } from "./card-cycles";
import type { ResolvedOpenCardInvoice } from "./open-card-invoice";
import type { CardPurchase } from "./types";

const cycle = {
  cycleId: "0219faee-6359-4071-ac45-8a0fa3423764",
  billId: null,
  referenceMonth: "2026-08-01",
  kind: "open",
  label: "Fatura vigente",
  compactLabel: "Jul–Ago",
  cycleStartDate: "2026-07-04",
  cycleEndDate: "2026-08-03",
  closingDate: "2026-08-03",
  dueDate: "2026-08-10",
  status: "open",
  source: "calculated",
  cardAccountId: "card-5718",
  cardId: "card-5718",
  cardIds: ["card-5718", "card-6579"],
  cardLabel: "Santander Unlimited MC Black",
  providerBillId: null,
  officialTotal: null,
  reconciliationDifference: null,
  identifiedEntriesTotal: null,
  creditsTotal: null,
  paymentsTotal: null,
  financeChargesTotal: null,
  previousBalance: null,
  lastReliableTotal: 7082.45,
  dataCompleteness: "partial",
  isCurrent: true,
} satisfies AvailableCardCycle;

const invoice = {
  cycleId: cycle.cycleId,
  cardAccountId: cycle.cardAccountId,
  cardIds: cycle.cardIds,
  cardName: cycle.cardLabel,
  cardLastFour: "5718",
  cycleStartDate: cycle.cycleStartDate,
  cycleEndDate: cycle.cycleEndDate,
  closingDate: cycle.closingDate,
  dueDate: cycle.dueDate,
  status: "open",
  confirmedOpenTotal: 7082.45,
  detailedTotal: 65.62,
  newPurchasesTotal: 65.62,
  postedInstallmentsTotal: 0,
  projectedInstallmentsTotal: 0,
  feesAndTaxesTotal: 0,
  creditsAndRefundsTotal: 0,
  reconciliationDifference: 7016.83,
  displayTotal: 7082.45,
  displayTotalSource: "last_reliable",
  dataCompleteness: "partial",
  totalReliability: "reliable",
  detailsCompleteness: "partial",
  updatedAt: "2026-07-28T09:00:00Z",
  confirmedAt: null,
  sourceLabel: "Pluggy — último valor confiável",
  snapshotCount: 0,
  cacheTag:
    "finance:card-cycle-details:personal:0219faee-6359-4071-ac45-8a0fa3423764",
} satisfies ResolvedOpenCardInvoice;

const purchase = (overrides: Partial<CardPurchase>): CardPurchase => ({
  id: "purchase",
  card_id: "card-6579",
  invoice_id: cycle.cycleId,
  description: "Compra",
  total_amount: 0,
  installment_amount: 0,
  purchase_date: "2026-07-10",
  installment_number: null,
  installment_count: null,
  source: "pluggy",
  source_type: "card",
  financial_origin: "invoice",
  transaction_role: "consumption",
  status: "realized",
  review_status: "reviewed",
  invoice_reference: null,
  bill_forecast_date: null,
  provider_category: null,
  merchant: null,
  visibility: "private",
  category_id: null,
  ...overrides,
});

test("mantém compra estrangeira sem conversão e separa total confiável do detalhe", () => {
  const details = buildResolvedCardCycleDetails({
    cycle,
    invoice,
    purchases: [
      purchase({
        id: "uber-20-95",
        description: "Uber *trip",
        original_amount: 20.95,
        original_currency_code: "USD",
        currency: "USD",
        amount_brl: null,
      }),
      purchase({
        id: "github-12-20",
        description: "Github, inc.",
        purchase_date: "2026-07-15",
        original_amount: 12.2,
        original_currency_code: "USD",
        currency: "USD",
        amount_brl: 65.62,
        foreign_iof_amount: 2.3,
      }),
    ],
    installmentsDataStatus: "confirmed_zero",
    movementCompleteness: "complete",
    unavailableSources: [],
    warnings: [],
    cardSource: "pluggy",
    paidAmount: 0,
    preservationReason: "transaction_endpoint_failure",
  });

  assert.equal(details.totals.confirmedTotal, 7082.45);
  assert.equal(details.totals.confirmedTotalSource, "pluggy_last_reliable");
  assert.equal(details.totals.pendingBalance, 7082.45);
  assert.equal(details.totals.detailedTotal, 65.62);
  assert.equal(details.completeness.detailsCompleteness, "partial");
  assert.equal(details.movements.length, 2);
  const uber = details.movements.find(item => item.id === "uber-20-95");
  assert.equal(uber?.originalAmount, 20.95);
  assert.equal(uber?.originalCurrencyCode, "USD");
  assert.equal(uber?.amountBrl, null);
  assert.equal(uber?.lowConfidence, true);
  assert.equal(
    details.movements.find(item => item.id === "github-12-20")
      ?.foreignIofAmount,
    2.3,
  );
});
