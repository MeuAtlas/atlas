import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCreditCardStatementViewModel,
  resolveStatementTotal,
} from "./credit-card-statement";

test("confirmed PDF wins over Pluggy Bill without changing payment state", () => {
  const statement = buildCreditCardStatementViewModel({
    lifecycleStatus: "closed",
    pdfTotal: 101.25,
    pluggyBillTotal: 100,
    hasConfirmedPdf: true,
    paidAmount: 0,
  });
  assert.equal(statement.total, 101.25);
  assert.equal(statement.totalSource, "statement_pdf");
  assert.equal(statement.detailsStatus, "confirmed");
  assert.equal(statement.paymentStatus, "unpaid");
});

test("closed Pluggy Bill is usable while detailed consumption awaits PDF", () => {
  const statement = buildCreditCardStatementViewModel({
    lifecycleStatus: "closed",
    pluggyBillTotal: 455.9,
    calculatedTotal: 430,
    hasConfirmedPdf: false,
    hasProvisionalEntries: true,
  });
  assert.equal(statement.total, 455.9);
  assert.equal(statement.totalSource, "pluggy_bill");
  assert.equal(statement.detailsStatus, "awaiting_pdf");
  assert.equal(statement.showProvisionalEntries, true);
});

test("open cycle never promotes its estimate to a definitive total", () => {
  const total = resolveStatementTotal({
    lifecycleStatus: "open",
    openEstimate: 219.2,
    calculatedTotal: 210,
  });
  assert.deepEqual(total, {
    amount: 219.2,
    source: "pluggy_open_estimate",
    definitive: false,
  });
});

test("bank allocation can mark a PDF-less statement as paid", () => {
  const statement = buildCreditCardStatementViewModel({
    lifecycleStatus: "closed",
    pluggyBillTotal: 700,
    hasConfirmedPdf: false,
    paidAmount: 700,
    paymentConfirmationStatus: "paid",
  });
  assert.equal(statement.detailsStatus, "awaiting_pdf");
  assert.equal(statement.paymentStatus, "paid");
  assert.equal(statement.remainingAmount, 0);
});
