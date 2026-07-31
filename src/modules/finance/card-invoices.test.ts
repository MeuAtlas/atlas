import assert from "node:assert/strict";
import test from "node:test";
import {
  analyzeInvoiceInclusion,
  buildCurrentCardInvoices,
  calculateInvoiceAmounts,
  comparePreviousCycleAtSameStage,
  deduplicateCardPurchases,
  deriveInvoiceStatus,
  getCurrentBillSummary,
  getCurrentInvoiceSummary,
  getEstimatedInvoiceDetails,
  isPendingPurchaseCarriedIntoOpenCycle,
  purchaseCompetenceDate,
  selectStoredInvoiceSnapshot,
} from "./card-invoices";
import type { CardPurchase, CreditCard, StoredCardInvoice } from "./types";

const purchase = (
  overrides: Partial<CardPurchase> & Pick<CardPurchase, "id" | "card_id">,
): CardPurchase => ({
  invoice_id: null,
  description: "Compra",
  total_amount: 100,
  installment_amount: 100,
  purchase_date: "2026-07-20",
  competence_date: "2026-07-20",
  installment_number: 1,
  installment_count: 1,
  source: "pluggy",
  source_type: "card",
  financial_origin: "credit_card",
  transaction_role: "consumption",
  status: "realized",
  review_status: "reviewed",
  invoice_reference: null,
  bill_forecast_date: null,
  provider_category: null,
  merchant: null,
  visibility: "private",
  category_id: null,
  original_amount: -100,
  ...overrides,
});
const card = (id: string): CreditCard => ({
  id,
  name: id,
  institution_name: "Banco",
  last_four_digits: "1234",
  brand: "Visa",
  credit_limit: 1000,
  used_limit: 0,
  current_balance: 0,
  provider_invoice_total: null,
  closing_day: 17,
  due_day: 1,
  status: "active",
  visibility: "private",
  linked_account_id: null,
  last_sync_at: null,
  source: "pluggy",
});

const officialCard = (id: string, total: number): CreditCard => ({
  ...card(id),
  provider_invoice_total: total,
  provider_bill_id: `${id}-bill-2026-08`,
  provider_bill_closing_date: "2026-08-17",
  provider_bill_due_date: "2026-09-01",
  provider_cycle_start_date: "2026-07-18",
});

test("compras, parcela, tarifa, estorno, crédito e pagamento têm papéis distintos", () => {
  const rows = [
    purchase({ id: "normal", card_id: "a" }),
    purchase({
      id: "parcela",
      card_id: "a",
      total_amount: 1200,
      installment_amount: 100,
      installment_number: 3,
      installment_count: 12,
    }),
    purchase({
      id: "tarifa",
      card_id: "a",
      installment_amount: 20,
      transaction_role: "adjustment",
      original_amount: -20,
    }),
    purchase({
      id: "estorno",
      card_id: "a",
      installment_amount: 30,
      transaction_role: "refund",
      original_amount: 30,
    }),
    purchase({
      id: "credito",
      card_id: "a",
      installment_amount: 10,
      transaction_role: "adjustment",
      original_amount: 10,
    }),
    purchase({
      id: "pagamento",
      card_id: "a",
      installment_amount: 50,
      transaction_role: "invoice_payment",
    }),
  ];
  assert.deepEqual(calculateInvoiceAmounts(rows), {
    purchasesTotal: 200,
    creditsTotal: 40,
    adjustmentsTotal: 20,
    invoiceTotal: 180,
    paidAmount: 50,
    outstandingAmount: 130,
    purchaseCount: 2,
  });
});

test("separa cartões e exclui ciclo anterior e cancelados", () => {
  const invoices = buildCurrentCardInvoices(
    [card("a"), card("b")],
    [
      purchase({ id: "a-current", card_id: "a" }),
      purchase({ id: "a-old", card_id: "a", purchase_date: "2026-07-17", competence_date: "2026-07-17" }),
      purchase({ id: "a-cancelled", card_id: "a", status: "cancelled" }),
      purchase({ id: "b-current", card_id: "b", installment_amount: 70 }),
    ],
    new Date("2026-07-23T12:00:00Z"),
  );
  assert.equal(invoices[0].invoiceTotal, 100);
  assert.equal(invoices[1].invoiceTotal, 70);
  assert.equal(invoices[0].availableLimit, 900);
});

test("fatura aberta nao reincorpora parcela vinculada a fatura anterior", () => {
  const currentCard: CreditCard = {
    ...card("a"),
    closing_day: 3,
    due_day: 10,
  };
  const invoice = buildCurrentCardInvoices(
    [currentCard],
    [
      purchase({
        id: "historic-installment",
        card_id: "a",
        invoice_id: "closed-invoice",
        installment_amount: 124.91,
        installment_number: 1,
        installment_count: 8,
        purchase_date: "2026-07-15",
        competence_date: "2026-07-15",
      }),
      purchase({
        id: "current-installment",
        card_id: "a",
        installment_amount: 124.91,
        installment_number: 6,
        installment_count: 8,
        purchase_date: "2026-07-15",
        competence_date: "2026-07-15",
      }),
    ],
    new Date("2026-07-30T12:00:00Z"),
  )[0];

  assert.equal(invoice.purchaseCount, 1);
  assert.equal(invoice.invoiceTotal, 124.91);
  assert.equal(invoice.purchases[0]?.id, "current-installment");
});

test("estimativa aberta nao soma parcelas conflitantes da mesma compra Pluggy", () => {
  const invoice = buildCurrentCardInvoices(
    [{ ...card("a"), closing_day: 3, due_day: 10 }],
    [
      purchase({
        id: "first-installment",
        card_id: "a",
        external_id: "provider-first",
        description: "On Sportswear",
        merchant: "ON SPORTSWEAR",
        installment_amount: 124.91,
        installment_number: 1,
        installment_count: 8,
        purchase_date: "2026-07-15",
        competence_date: "2026-07-15",
      }),
      purchase({
        id: "sixth-installment",
        card_id: "a",
        external_id: "provider-sixth",
        description: "On Sportswear",
        merchant: "ON SPORTSWEAR",
        installment_amount: 124.91,
        installment_number: 6,
        installment_count: 8,
        purchase_date: "2026-07-15",
        competence_date: "2026-07-15",
      }),
    ],
    new Date("2026-07-30T12:00:00Z"),
  )[0];

  assert.equal(invoice.purchaseCount, 1);
  assert.equal(invoice.invoiceTotal, 124.91);
});

test("ausência de fechamento produz estado não configurado", () => {
  const withoutDates = { ...card("a"), closing_day: null, due_day: null };
  assert.equal(buildCurrentCardInvoices([withoutDates], [])[0].cycle, null);
});

test("resumo vigente preserva valor calculado e compras sem Bill oficial", () => {
  const currentCard: CreditCard = {
    ...card("santander"),
    closing_day: 3,
    due_day: 10,
    provider_invoice_total: null,
    provider_bill_id: null,
  };
  const rows = Array.from({ length: 36 }, (_, index) =>
    purchase({
      id: `purchase-${index + 1}`,
      card_id: currentCard.id,
      purchase_date: `2026-07-${String(4 + (index % 25)).padStart(2, "0")}`,
      competence_date: `2026-07-${String(4 + (index % 25)).padStart(2, "0")}`,
      installment_amount: index === 35 ? 136.78 : 90,
    }),
  );
  const invoice = buildCurrentCardInvoices(
    [currentCard],
    rows,
    new Date("2026-07-25T12:00:00Z"),
  )[0];
  const summary = getCurrentBillSummary(invoice);

  assert.ok(Math.abs((summary.amount ?? 0) - 3286.78) < 0.001);
  assert.equal(summary.amountSource, "calculated_transactions");
  assert.equal(summary.purchasesCount, 36);
  assert.equal(summary.periodStart, "2026-07-04");
  assert.equal(summary.periodEnd, "2026-08-03");
  assert.equal(summary.closesAt, "2026-08-03");
  assert.equal(summary.dueAt, "2026-08-10");
  assert.equal(summary.statusLabel, "Fatura aberta");
  assert.equal(summary.isEstimated, true);
  assert.equal(summary.isOfficial, false);
  assert.match(summary.warningMessage ?? "", /calculado pelas movimentações/);
});

test("resumo visual reaproveita a fatura normalizada e aplica status temporal", () => {
  const invoice = buildCurrentCardInvoices(
    [
      {
        ...card("visual"),
        closing_day: 27,
        due_day: 3,
      },
    ],
    [
      purchase({
        id: "visual-purchase",
        card_id: "visual",
        installment_amount: 250,
      }),
    ],
    new Date("2026-07-26T12:00:00Z"),
  )[0];
  const summary = getCurrentInvoiceSummary(
    invoice,
    new Date("2026-07-26T12:00:00Z"),
  );

  assert.equal(summary.displayAmount, 250);
  assert.equal(summary.purchaseCount, 1);
  assert.equal(summary.amountSourceLabel, "Valor estimado");
  assert.equal(summary.statusLabel, "Fecha amanhã");
  assert.equal(summary.dataCompleteness, "complete");
});

test("resumo vigente respeita uma Bill oficial realmente zerada", () => {
  const invoice = buildCurrentCardInvoices(
    [
      {
        ...officialCard("official-zero", 0),
      },
    ],
    [
      purchase({
        id: "calculated",
        card_id: "official-zero",
        purchase_date: "2026-07-20",
        competence_date: "2026-07-20",
        installment_amount: 250,
      }),
    ],
    new Date("2026-07-23T12:00:00Z"),
  )[0];
  const summary = getCurrentBillSummary(invoice);

  assert.equal(summary.amount, 0);
  assert.equal(summary.amountSource, "provider_bill");
  assert.equal(summary.purchasesCount, 1);
  assert.equal(summary.isOfficial, true);
});

test("falha da consulta não é apresentada como fatura realmente zerada", () => {
  const invoice = buildCurrentCardInvoices(
    [card("unavailable")],
    [],
    new Date("2026-07-23T12:00:00Z"),
    { purchaseDataAvailable: false },
  )[0];
  const summary = getCurrentBillSummary(invoice);

  assert.equal(summary.amount, null);
  assert.equal(summary.purchasesCount, null);
  assert.equal(summary.isEstimated, false);
  assert.match(summary.warningMessage ?? "", /indisponíveis/);
});

test("compara o ciclo anterior no mesmo estágio", () => {
  const rows = [
    purchase({ id: "current", card_id: "a", purchase_date: "2026-07-20", competence_date: "2026-07-20" }),
    purchase({
      id: "previous",
      card_id: "a",
      purchase_date: "2026-06-20",
      competence_date: "2026-06-20",
      installment_amount: 80,
    }),
    purchase({
      id: "previous-late",
      card_id: "a",
      purchase_date: "2026-07-10",
      competence_date: "2026-07-10",
      installment_amount: 500,
    }),
  ];
  const current = buildCurrentCardInvoices(
    [card("a")],
    rows,
    new Date("2026-07-23T12:00:00Z"),
  )[0];
  const comparison = comparePreviousCycleAtSameStage(
    current,
    rows,
    new Date("2026-07-23T12:00:00Z"),
  );
  assert.equal(comparison?.previousTotal, 80);
  assert.equal(comparison?.difference, 20);
});

test("reconcilia dois instrumentos, estorno e lançamentos sem identificação",()=>{
  const withInstruments={...officialCard("a",190),credit_card_instruments:[
    {id:"i1",credit_card_id:"a",external_id:"one",last_four_digits:"5718",card_kind:"physical" as const,display_name:"Físico",provider_status:"active",user_archived_at:null,source:"pluggy"},
    {id:"i2",credit_card_id:"a",external_id:"two",last_four_digits:"0613",card_kind:"online" as const,display_name:"Online",provider_status:"active",user_archived_at:null,source:"pluggy"},
  ]};
  const rows=[
    purchase({id:"one",card_id:"a",instrument_id:"i1",installment_amount:100}),
    purchase({id:"two",card_id:"a",instrument_id:"i2",installment_amount:50}),
    purchase({id:"refund",card_id:"a",instrument_id:"i1",installment_amount:10,transaction_role:"refund"}),
    purchase({id:"unassigned",card_id:"a",instrument_id:null,installment_amount:30}),
    purchase({id:"fee",card_id:"a",instrument_id:null,installment_amount:20,transaction_role:"adjustment",original_amount:-20}),
  ];
  const invoice=buildCurrentCardInvoices([withInstruments],rows,new Date("2026-07-23T12:00:00Z"))[0];
  assert.deepEqual(invoice.instrumentTotals.map(item=>[item.lastFour,item.netTotal,item.purchaseCount]),[["5718",90,1],["0613",50,1]]);
  assert.equal(invoice.instrumentsTotal,140);
  assert.equal(invoice.unassignedTotal,30);
  assert.equal(invoice.generalAdjustmentsTotal,20);
  assert.equal(invoice.invoiceTotal,190);
  assert.equal(invoice.reconciliationStatus,"matched");
});

test("fatura vigente usa a data real da compra quando a previsao da Pluggy aponta para o primeiro dia do mes",()=>{
  const currentCard={
    ...card("santander"),
    last_four_digits:"5718",
    closing_day:3,
    due_day:10,
    credit_card_instruments:[
      {id:"holder",credit_card_id:"santander",external_id:"holder",last_four_digits:"5718",card_kind:"physical" as const,display_name:"Titular",provider_status:"active",user_archived_at:null,source:"pluggy"},
      {id:"additional",credit_card_id:"santander",external_id:"additional",last_four_digits:"0613",card_kind:"additional" as const,display_name:"Adicional",provider_status:"active",user_archived_at:null,source:"pluggy"},
    ],
  };
  const rows=[
    purchase({id:"holder",card_id:"santander",instrument_id:"holder",purchase_date:"2026-07-12",competence_date:"2026-07-01",bill_forecast_date:"2026-07-01",installment_amount:100}),
    purchase({id:"additional-one",card_id:"santander",instrument_id:"additional",purchase_date:"2026-07-10",competence_date:"2026-07-01",bill_forecast_date:"2026-07-01",installment_amount:500}),
    purchase({id:"additional-two",card_id:"santander",instrument_id:"additional",purchase_date:"2026-07-20",competence_date:"2026-07-01",bill_forecast_date:"2026-07-01",installment_amount:88.88}),
  ];

  assert.equal(purchaseCompetenceDate(rows[1]),"2026-07-10");
  const invoice=buildCurrentCardInvoices(
    [currentCard],
    rows,
    new Date("2026-07-28T12:00:00Z"),
  )[0];
  assert.deepEqual(
    invoice.instrumentTotals.map(total=>[
      total.lastFour,
      total.netTotal,
      total.purchaseCount,
    ]),
    [["5718",100,1],["0613",588.88,2]],
  );
});

test("parcela projetada continua usando a competencia prevista",()=>{
  const projected=purchase({
    id:"projected",
    card_id:"a",
    source:"projection",
    status:"projected",
    purchase_date:"2026-07-10",
    competence_date:"2026-08-01",
    bill_forecast_date:"2026-08-01",
  });
  assert.equal(purchaseCompetenceDate(projected),"2026-08-01");
});

test("Bill.totalAmount é a fatura oficial e a diferença permanece explícita",()=>{
  const official={...officialCard("mastercard",6007.21),account_credit_balance:5900};
  const rows=[purchase({id:"partial",card_id:"mastercard",installment_amount:3602.25})];
  const invoice=buildCurrentCardInvoices([official],rows,new Date("2026-07-23T12:00:00Z"))[0];
  assert.equal(invoice.totalSource,"provider_bill");
  assert.equal(invoice.invoiceTotal,6007.21);
  assert.equal(invoice.calculatedInvoiceTotal,3602.25);
  assert.ok(Math.abs((invoice.reconciliationDifference??0)-2404.96)<0.001);
  assert.equal(invoice.reconciliationStatus,"divergent");
});

test("Account.balance agregado fica apenas no diagnóstico quando a Bill não está disponível",()=>{
  const accountTotal={...card("a"),account_credit_balance:450};
  const invoice=buildCurrentCardInvoices([accountTotal],[purchase({id:"partial",card_id:"a",installment_amount:300})],new Date("2026-07-23T12:00:00Z"))[0];
  assert.equal(invoice.totalSource,"calculated_transactions");
  assert.equal(invoice.accountCreditBalance,450);
  assert.equal(invoice.invoiceTotal,300);
  assert.equal(invoice.calculatedInvoiceTotal,300);
  assert.equal(invoice.reconciliationDifference,null);
});

test("transação PENDING sem billId entra na fatura vigente",()=>{
  const rows=[
    purchase({id:"pending",card_id:"a",status:"pending",provider_bill_id:null,installment_amount:125}),
    purchase({id:"posted",card_id:"a",status:"realized",provider_bill_id:"bill",installment_amount:75}),
  ];
  const invoice=buildCurrentCardInvoices([card("a")],rows,new Date("2026-07-23T12:00:00Z"))[0];
  assert.equal(invoice.calculatedInvoiceTotal,200);
  assert.equal(invoice.pendingTransactionsTotal,125);
  assert.equal(invoice.pendingTransactionsCount,1);
  assert.equal(invoice.postedTransactionsCount,1);
  assert.equal(invoice.withBillIdCount,1);
  assert.equal(invoice.withoutBillIdCount,1);
});

test("Mastercard e Visa preservam Bills independentes",()=>{
  const mastercard=officialCard("mastercard",6007.21);
  const visa=officialCard("visa",2100.50);
  const invoices=buildCurrentCardInvoices([mastercard,visa],[
    purchase({id:"mc",card_id:"mastercard",installment_amount:100}),
    purchase({id:"visa",card_id:"visa",installment_amount:80}),
  ],new Date("2026-07-23T12:00:00Z"));
  assert.deepEqual(invoices.map(invoice=>invoice.invoiceTotal),[6007.21,2100.50]);
  assert.deepEqual(invoices.map(invoice=>invoice.calculatedInvoiceTotal),[100,80]);
});

test("compra parcelada soma somente a parcela do ciclo",()=>{
  const invoice=buildCurrentCardInvoices([card("a")],[
    purchase({id:"installment",card_id:"a",total_amount:1200,installment_amount:100,installment_number:3,installment_count:12}),
  ],new Date("2026-07-23T12:00:00Z"))[0];
  assert.equal(invoice.purchasesTotal,100);
  assert.equal(invoice.invoiceTotal,100);
});

test("valor bancário manual é usado sem criar compras e Bill futura o substitui",()=>{
  const manuallyConfirmed={...card("a"),card_invoice_confirmations:[{id:"confirmation",card_id:"a",reference_month:"2026-08-01",official_amount:6007.21,source:"manual_bank_confirmation" as const,informed_at:"2026-07-23T12:00:00Z",note:null}]};
  const rows=[purchase({id:"partial",card_id:"a",installment_amount:3602.25})];
  const manual=buildCurrentCardInvoices([manuallyConfirmed],rows,new Date("2026-07-23T12:00:00Z"))[0];
  assert.equal(manual.totalSource,"manual_bank_confirmation");
  assert.equal(manual.invoiceTotal,6007.21);
  assert.equal(manual.purchases.length,1);
  const provider=buildCurrentCardInvoices([{...officialCard("a",6100),card_invoice_confirmations:manuallyConfirmed.card_invoice_confirmations}],rows,new Date("2026-07-23T12:00:00Z"))[0];
  assert.equal(provider.totalSource,"provider_bill");
  assert.equal(provider.invoiceTotal,6100);
});

test("diagnóstico explica inclusões e exclusões sem descartar PENDING do ciclo",()=>{
  const rows=[
    purchase({id:"included",card_id:"a",status:"pending",provider_bill_id:null}),
    purchase({id:"outside",card_id:"a",purchase_date:"2026-06-01",competence_date:"2026-06-01"}),
    purchase({id:"payment",card_id:"a",transaction_role:"invoice_payment"}),
    purchase({id:"cancelled",card_id:"a",status:"cancelled"}),
  ];
  const diagnostic=analyzeInvoiceInclusion(card("a"),rows,new Date("2026-07-23T12:00:00Z"));
  assert.equal(diagnostic.includedCount,1);
  assert.equal(diagnostic.exclusionCounts.outside_cycle,1);
  assert.equal(diagnostic.exclusionCounts.invoice_payment,1);
  assert.equal(diagnostic.exclusionCounts.cancelled,1);
  assert.equal(diagnostic.exclusionCounts.pending_not_included,0);
});

test("caso Santander separa fatura anterior paga da fatura aberta", () => {
  const santander: CreditCard = {
    ...card("mastercard"),
    closing_day: 3,
    due_day: 10,
    provider_invoice_total: 500,
    provider_bill_id: "bill-previous",
    provider_bill_closing_date: "2026-07-03",
    provider_bill_due_date: "2026-07-10",
    provider_cycle_start_date: "2026-06-04",
  };
  const rows = [
    purchase({
      id: "old-consumption",
      card_id: "mastercard",
      purchase_date: "2026-06-20",
      competence_date: "2026-06-20",
      installment_amount: 500,
      provider_bill_id: "bill-previous",
    }),
    purchase({
      id: "previous-payment",
      card_id: "mastercard",
      purchase_date: "2026-07-05",
      competence_date: "2026-07-05",
      installment_amount: 500,
      transaction_role: "invoice_payment",
      review_status: "pending",
    }),
    purchase({
      id: "cycle-start",
      card_id: "mastercard",
      purchase_date: "2026-07-04",
      competence_date: "2026-07-04",
      installment_amount: 100,
    }),
    purchase({
      id: "cycle-end",
      card_id: "mastercard",
      purchase_date: "2026-08-03",
      competence_date: "2026-08-03",
      installment_amount: 200,
    }),
    purchase({
      id: "after-closing",
      card_id: "mastercard",
      purchase_date: "2026-08-04",
      competence_date: "2026-08-04",
      installment_amount: 900,
    }),
  ];

  const current = buildCurrentCardInvoices(
    [santander],
    rows,
    new Date("2026-07-25T15:00:00Z"),
  )[0];
  assert.equal(current.cycle?.cycleStart, "2026-07-04");
  assert.equal(current.cycle?.cycleEnd, "2026-08-03");
  assert.equal(current.cycle?.dueDate, "2026-08-10");
  assert.equal(current.totalSource, "calculated_transactions");
  assert.equal(current.invoiceTotal, 300);
  assert.equal(current.paidAmount, 0);
  assert.equal(current.status, "open");

  const previous = buildCurrentCardInvoices(
    [santander],
    rows,
    new Date("2026-07-03T15:00:00Z"),
  )[0];
  assert.equal(previous.cycle?.cycleStart, "2026-06-04");
  assert.equal(previous.cycle?.cycleEnd, "2026-07-03");
  assert.equal(previous.totalSource, "provider_bill");
  assert.equal(previous.invoiceTotal, 500);
  assert.equal(previous.paidAmount, 500);
  assert.equal(previous.status, "paid");
});

test("versão POSTED substitui a PENDING equivalente sem duplicar", () => {
  const rows = [
    purchase({
      id: "pending-version",
      external_id: "pending-version",
      card_id: "a",
      status: "pending",
      purchase_date: "2026-07-20",
      installment_amount: 125,
    }),
    purchase({
      id: "posted-version",
      external_id: "posted-version",
      card_id: "a",
      status: "realized",
      purchase_date: "2026-07-21",
      installment_amount: 125,
    }),
  ];
  assert.deepEqual(
    deduplicateCardPurchases(rows).map((item) => item.id),
    ["posted-version"],
  );
});

test("compra pendente no corte permanece provisoriamente na fatura aberta", () => {
  const santander = {
    ...card("mastercard"),
    closing_day: 3,
    due_day: 10,
  };
  const pendingAtCutoff = purchase({
    id: "pending-at-cutoff",
    card_id: "mastercard",
    status: "pending",
    purchase_date: "2026-07-03",
    competence_date: "2026-07-01",
    installment_amount: 40,
    provider_bill_id: null,
    invoice_reference: null,
  });
  const current = buildCurrentCardInvoices(
    [santander],
    [pendingAtCutoff],
    new Date("2026-07-30T15:00:00Z"),
  )[0];

  assert.equal(current.cycle?.cycleStart, "2026-07-04");
  assert.equal(
    isPendingPurchaseCarriedIntoOpenCycle(pendingAtCutoff, current.cycle!),
    true,
  );
  assert.deepEqual(current.purchases.map((item) => item.id), [
    "pending-at-cutoff",
  ]);
  assert.equal(current.calculatedInvoiceTotal, 40);
  assert.equal(current.pendingTransactionsTotal, 40);
});

test("referência definitiva impede carregar compra pendente para o ciclo seguinte", () => {
  const santander = {
    ...card("mastercard"),
    closing_day: 3,
    due_day: 10,
  };
  const pendingWithBill = purchase({
    id: "pending-with-bill",
    card_id: "mastercard",
    status: "pending",
    purchase_date: "2026-07-03",
    competence_date: "2026-07-03",
    installment_amount: 40,
    provider_bill_id: "previous-provider-bill",
    invoice_reference: "previous-provider-bill",
  });
  const current = buildCurrentCardInvoices(
    [santander],
    [pendingWithBill],
    new Date("2026-07-30T15:00:00Z"),
  )[0];

  assert.equal(
    isPendingPurchaseCarriedIntoOpenCycle(pendingWithBill, current.cycle!),
    false,
  );
  assert.equal(current.purchases.length, 0);
  assert.equal(current.calculatedInvoiceTotal, 0);
});

test("status diferencia fechamento, vencimento e pagamento", () => {
  const invoice = buildCurrentCardInvoices(
    [card("a")],
    [],
    new Date("2026-07-23T15:00:00Z"),
  )[0];
  assert.equal(
    deriveInvoiceStatus({
      cycle: invoice.cycle,
      invoiceTotal: 100,
      paidAmount: 0,
      referenceDate: new Date("2026-08-20T15:00:00Z"),
    }),
    "closed",
  );
  assert.equal(
    deriveInvoiceStatus({
      cycle: invoice.cycle,
      invoiceTotal: 100,
      paidAmount: 0,
      referenceDate: new Date("2026-09-02T15:00:00Z"),
    }),
    "overdue",
  );
});

test("detalhamento usa somente lançamentos que formam o total do ciclo", () => {
  const rows = [
    purchase({ id: "purchase", card_id: "a", installment_amount: 100 }),
    purchase({
      id: "installment",
      card_id: "a",
      installment_amount: 50,
      is_installment: true,
      installment_number: 3,
      installment_count: 10,
    }),
    purchase({
      id: "refund",
      card_id: "a",
      installment_amount: 20,
      transaction_role: "refund",
      original_amount: 20,
    }),
    purchase({
      id: "credit",
      card_id: "a",
      installment_amount: 10,
      transaction_role: "adjustment",
      original_amount: 10,
    }),
    purchase({
      id: "fee",
      card_id: "a",
      description: "Tarifa internacional",
      installment_amount: 5,
      transaction_role: "adjustment",
      original_amount: -5,
    }),
    purchase({
      id: "adjustment",
      card_id: "a",
      description: "Ajuste de arredondamento",
      installment_amount: 7,
      transaction_role: "adjustment",
      original_amount: -7,
    }),
    purchase({
      id: "payment",
      card_id: "a",
      purchase_date: "2026-08-20",
      competence_date: "2026-08-20",
      installment_amount: 132,
      transaction_role: "invoice_payment",
    }),
    purchase({
      id: "review",
      card_id: "a",
      installment_amount: 30,
      review_status: "pending",
    }),
    purchase({
      id: "cancelled",
      card_id: "a",
      installment_amount: 40,
      status: "cancelled",
    }),
    purchase({
      id: "previous-cycle",
      card_id: "a",
      purchase_date: "2026-07-17",
      competence_date: "2026-07-17",
      installment_amount: 60,
    }),
  ];
  const invoice = buildCurrentCardInvoices(
    [card("a")],
    rows,
    new Date("2026-07-23T12:00:00Z"),
  )[0];
  const details = getEstimatedInvoiceDetails(invoice);

  assert.deepEqual(
    details.includedPurchases.map((item) => item.id),
    ["purchase", "installment", "refund", "credit", "fee", "adjustment"],
  );
  assert.equal(details.purchaseTotal, 150);
  assert.equal(details.refundTotal, 20);
  assert.equal(details.creditTotal, 10);
  assert.equal(details.feeTotal, 5);
  assert.equal(details.adjustmentTotal, 7);
  assert.equal(details.calculatedTotal, 132);
  assert.equal(details.calculatedTotal, invoice.calculatedInvoiceTotal);
  assert.deepEqual(details.linkedPayments.map((item) => item.id), ["payment"]);
  assert.ok(
    details.excludedItems.some(
      ({ purchase: item, reason }) =>
        item.id === "previous-cycle" && reason === "outside_cycle",
    ),
  );
  assert.ok(
    details.excludedItems.some(
      ({ purchase: item, reason }) =>
        item.id === "cancelled" && reason === "cancelled",
    ),
  );
  assert.ok(
    details.excludedItems.some(
      ({ purchase: item, reason }) =>
        item.id === "review" && reason === "awaiting_review",
    ),
  );
});

test("detalhamento preserva instrumentos e expõe duplicata conciliada", () => {
  const instrumentCard = {
    ...card("a"),
    credit_card_instruments: [
      {
        id: "physical",
        credit_card_id: "a",
        external_id: "physical",
        last_four_digits: "5718",
        card_kind: "physical" as const,
        display_name: "Físico",
        provider_status: "active",
        user_archived_at: null,
        source: "pluggy",
      },
      {
        id: "virtual",
        credit_card_id: "a",
        external_id: "virtual",
        last_four_digits: "0613",
        card_kind: "virtual" as const,
        display_name: "Virtual",
        provider_status: "active",
        user_archived_at: null,
        source: "pluggy",
      },
    ],
  };
  const rows = [
    purchase({
      id: "physical-pending",
      external_id: "physical-pending",
      card_id: "a",
      instrument_id: "physical",
      status: "pending",
      description: "Mercado",
    }),
    purchase({
      id: "physical-posted",
      external_id: "physical-posted",
      card_id: "a",
      instrument_id: "physical",
      status: "realized",
      description: "Mercado",
      purchase_date: "2026-07-21",
      competence_date: "2026-07-21",
    }),
    purchase({
      id: "virtual",
      card_id: "a",
      instrument_id: "virtual",
      installment_amount: 70,
    }),
    purchase({
      id: "unassigned",
      card_id: "a",
      instrument_id: null,
      installment_amount: 30,
    }),
  ];
  const details = getEstimatedInvoiceDetails(
    buildCurrentCardInvoices(
      [instrumentCard],
      rows,
      new Date("2026-07-23T12:00:00Z"),
    )[0],
  );

  assert.deepEqual(
    details.includedPurchases.map((item) => item.id).sort(),
    ["physical-posted", "unassigned", "virtual"],
  );
  assert.equal(details.calculatedTotal, 200);
  assert.ok(
    details.excludedItems.some(
      ({ purchase: item, reason }) =>
        item.id === "physical-pending" && reason === "duplicate",
    ),
  );
  assert.deepEqual(
    new Set(details.includedPurchases.map((item) => item.instrument_id)),
    new Set(["physical", "virtual", null]),
  );
});

test("fatura parcial usa o snapshot confiável sem transformar ausência em zero",()=>{
  const partialCard:CreditCard={
    ...card("santander"),
    last_four_digits:"5718",
    closing_day:3,
    due_day:10,
    provider_status:"degraded",
    bank_connections:{
      data_completeness:"partial",
      provider_status:"degraded",
      last_complete_sync_at:"2026-07-26T10:00:00.000Z",
    },
  };
  const stored:StoredCardInvoice={
    id:"invoice",card_id:"santander",reference_month:"2026-08-01",
    cycle_start_date:"2026-07-04",cycle_end_date:"2026-08-03",
    closing_date:"2026-08-03",due_date:"2026-08-10",
    total_amount:3286.78,paid_amount:0,paid_at:null,
    outstanding_amount:3286.78,purchase_count:36,status:"open",
    external_id:"atlas:santander:2026-08",provider_invoice_total:null,
    calculated_invoice_total:3286.78,manual_invoice_total:null,
    confirmed_invoice_total:null,last_reliable_invoice_total:3286.78,
    last_reliable_purchase_count:36,data_completeness:"partial",
    total_source:"calculated_transactions",reconciliation_difference:null,
    reconciliation_status:"provider_unavailable",provider_updated_at:null,
    invoice_breakdown:null,
  };
  const invoice=buildCurrentCardInvoices(
    [partialCard],[],new Date("2026-07-27T12:00:00Z"),
    {storedInvoices:[stored]},
  )[0];
  const summary=getCurrentInvoiceSummary(
    invoice,new Date("2026-07-27T12:00:00Z"),
  );
  assert.equal(summary.displayAmount,3286.78);
  assert.equal(summary.purchaseCount,36);
  assert.equal(summary.cycleStart,"2026-07-04");
  assert.equal(summary.cycleEnd,"2026-08-03");
  assert.equal(summary.dataCompleteness,"partial");
  assert.equal(invoice.reliableSnapshotUsed,true);
});

test("fatura parcial com zero corrompido e sem evidência fica indisponível",()=>{
  const partialCard:CreditCard={
    ...card("partial-empty"),provider_status:"degraded",
    closing_day:3,due_day:10,
    bank_connections:{data_completeness:"partial",provider_status:"degraded",
      last_complete_sync_at:null},
  };
  const stored:StoredCardInvoice={
    id:"empty",card_id:"partial-empty",reference_month:"2026-08-01",
    cycle_start_date:"2026-07-04",cycle_end_date:"2026-08-03",
    closing_date:"2026-08-03",due_date:"2026-08-10",
    total_amount:0,paid_amount:0,paid_at:null,outstanding_amount:0,
    purchase_count:0,status:"open",external_id:"atlas:empty",
    provider_invoice_total:0,calculated_invoice_total:0,
    manual_invoice_total:null,confirmed_invoice_total:null,
    last_reliable_invoice_total:0,last_reliable_purchase_count:0,
    data_completeness:"partial",last_complete_sync_at:null,
    total_source:"calculated_transactions",reconciliation_difference:null,
    reconciliation_status:"provider_unavailable",provider_updated_at:null,
  };
  const invoice=buildCurrentCardInvoices(
    [partialCard],[],new Date("2026-07-27T12:00:00Z"),
    {storedInvoices:[stored]},
  )[0];
  const summary=getCurrentInvoiceSummary(invoice);
  assert.equal(summary.displayAmount,null);
  assert.equal(summary.purchaseCount,null);
  assert.equal(summary.dataCompleteness,"partial");
  assert.match(summary.warningMessage??"",/não enviou dados suficientes/i);
});

test("parcial recupera cálculo e compras persistidos antes do backfill",()=>{
  const partialCard:CreditCard={
    ...card("legacy"),provider_status:"degraded",closing_day:3,due_day:10,
    bank_connections:{data_completeness:"partial",provider_status:"degraded",
      last_complete_sync_at:"2026-07-25T10:00:00.000Z"},
  };
  const stored:StoredCardInvoice={
    id:"legacy-good",card_id:"legacy",reference_month:"2026-08-01",
    cycle_start_date:"2026-07-04",cycle_end_date:"2026-08-03",
    closing_date:"2026-08-03",due_date:"2026-08-10",
    total_amount:450,paid_amount:0,paid_at:null,outstanding_amount:450,
    purchase_count:4,status:"open",external_id:"atlas:legacy",
    provider_invoice_total:null,calculated_invoice_total:450,
    manual_invoice_total:null,confirmed_invoice_total:null,
    last_reliable_invoice_total:null,last_reliable_purchase_count:null,
    data_completeness:"partial",
    last_complete_sync_at:"2026-07-25T10:00:00.000Z",
    total_source:"calculated_transactions",reconciliation_difference:null,
    reconciliation_status:"provider_unavailable",provider_updated_at:null,
  };
  const summary=getCurrentInvoiceSummary(buildCurrentCardInvoices(
    [partialCard],[],new Date("2026-07-27T12:00:00Z"),
    {storedInvoices:[stored]},
  )[0]);
  assert.equal(summary.displayAmount,450);
  assert.equal(summary.purchaseCount,4);
});

test("selector não deixa snapshot auxiliar vazio substituir o válido",()=>{
  const base:StoredCardInvoice={
    id:"empty",card_id:"same",reference_month:"2026-08-01",
    cycle_start_date:"2026-07-04",cycle_end_date:"2026-08-03",
    closing_date:"2026-08-03",due_date:"2026-08-10",
    total_amount:0,paid_amount:0,paid_at:null,outstanding_amount:0,
    purchase_count:0,status:"open",external_id:"empty",
    provider_invoice_total:null,calculated_invoice_total:0,
    manual_invoice_total:null,total_source:"calculated_transactions",
    reconciliation_status:"provider_unavailable",provider_updated_at:null,
  };
  const selected=selectStoredInvoiceSnapshot({
    card:{...card("same"),external_id:"account-1"},
    referenceMonth:"2026-08",
    invoices:[
      {...base,provider_account_id:"account-1"},
      {...base,id:"good",external_id:"good",calculated_invoice_total:700,
        purchase_count:7,last_reliable_invoice_total:700,
        last_reliable_purchase_count:7,provider_account_id:"account-1"},
    ],
  });
  assert.equal(selected?.id,"good");
});

test("limite nunca informado permanece indisponível",()=>{
  const withoutLimit={...card("no-limit"),credit_limit:null} as unknown as CreditCard;
  const invoice=buildCurrentCardInvoices(
    [withoutLimit],[],new Date("2026-07-23T12:00:00Z"),
  )[0];
  assert.equal(invoice.availableLimit,null);
});
