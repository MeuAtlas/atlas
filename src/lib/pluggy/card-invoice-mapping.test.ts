import assert from "node:assert/strict";
import test from "node:test";
import { mapCard, mapCardPurchase, safeBillDiagnostic, selectCurrentPluggyBill } from "./mappers";

test("cartão sem datas do provedor não inventa fechamento ou vencimento", () => {
  const row = mapCard(
    { id: "card", type: "CREDIT", creditData: { creditLimit: 1000 } },
    "owner",
    "connection",
  );
  assert.equal(row.closing_day, undefined);
  assert.equal(row.due_day, undefined);
});

test("compra com cartão identificado é revisada e pagamento continua pendente", () => {
  const purchase = mapCardPurchase(
    { id: "purchase", accountId: "credit", amount: -50, date: "2026-07-20" },
    "owner",
    "connection",
    "card",
  );
  const payment = mapCardPurchase(
    {
      id: "payment",
      accountId: "credit",
      amount: 50,
      date: "2026-07-20",
      description: "Pagamento de fatura",
    },
    "owner",
    "connection",
    "card",
  );
  assert.equal(purchase.review_status, "reviewed");
  assert.equal(payment.review_status, "pending");
});

test("Bill atual fornece total e datas oficiais antes de Account.balance",()=>{
  const context=selectCurrentPluggyBill([
    {id:"old",dueDate:"2026-07-10",billClosingDate:"2026-07-01",totalAmount:100},
    {id:"current",dueDate:"2026-08-10",billClosingDate:"2026-08-01",totalAmount:6007.21},
  ],new Date("2026-07-23T12:00:00Z"));
  const row=mapCard({id:"card",type:"CREDIT",balance:5900,creditData:{creditLimit:10000}},"owner","connection",context);
  assert.equal(row.provider_invoice_total,6007.21);
  assert.equal(row.account_credit_balance,5900);
  assert.equal(row.provider_bill_id,"current");
  assert.equal(row.provider_cycle_start_date,"2026-07-02");
  assert.equal(row.dates_source,"provider_bill");
});

test("diagnóstico de Bills registra datas e disponibilidade sem expor valores",()=>{
  const diagnostic=safeBillDiagnostic([{id:"bill-mastercard-2026-08",accountId:"mastercard",dueDate:"2026-08-10",billClosingDate:"2026-08-04",totalAmount:6007.21,status:"OPEN"}],null);
  assert.deepEqual(diagnostic.bills,[{reference:"bill…6-08",dueDate:"2026-08-10",billClosingDate:"2026-08-04",hasTotalAmount:true,status:"OPEN"}]);
  assert.equal("totalAmount" in diagnostic.bills[0],false);
});

test("metadados documentados preservam billId, parcela e PENDING sem billId",()=>{
  const pending=mapCardPurchase({id:"pending",accountId:"credit",amount:125,date:"2026-07-23",status:"PENDING",creditCardMetadata:{installmentNumber:2,totalInstallments:6,totalAmount:750,billForecastDate:"2026-08"}},"owner","connection","card");
  assert.equal(pending.provider_bill_id,null);
  assert.equal(pending.status,"pending");
  assert.equal(pending.installment_number,2);
  assert.equal(pending.installment_count,6);
  assert.equal(pending.competence_date,"2026-08-01");
});

test("seleção de Bill rejeita fatura explicitamente vinculada a outra conta",()=>{
  const context=selectCurrentPluggyBill([
    {id:"mastercard-bill",accountId:"mastercard",dueDate:"2026-08-10",billClosingDate:"2026-08-03",totalAmount:6007.21},
    {id:"visa-bill",accountId:"visa",dueDate:"2026-08-10",billClosingDate:"2026-08-03",totalAmount:2100.50},
  ],new Date("2026-07-23T12:00:00Z"),"visa");
  assert.equal(context.current?.id,"visa-bill");
  assert.equal(context.current?.totalAmount,2100.50);
});

test("limite utilizado não confunde Account.balance com consumo do limite",()=>{
  const row=mapCard({id:"card",type:"CREDIT",balance:15655.74,creditData:{creditLimit:30000,availableCreditLimit:24000}},"owner","connection");
  assert.equal(row.account_credit_balance,15655.74);
  assert.equal(row.used_limit,6000);
  assert.equal(row.provider_invoice_total,null);
});

test("data UTC não desloca lançamento do primeiro dia para fora do ciclo",()=>{
  const row=mapCardPurchase({id:"utc",accountId:"card",amount:100,date:"2026-07-05T00:00:00.000Z",status:"PENDING",creditCardMetadata:{}},"owner","connection","card");
  assert.equal(row.competence_date,"2026-07-05");
  assert.equal(row.purchase_date,"2026-07-05");
});
