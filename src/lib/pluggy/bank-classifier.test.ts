import assert from "node:assert/strict";
import test from "node:test";
import {
  BANK_CLASSIFIER_VERSION,
  classifyBankTransaction,
  providerBankDirection,
} from "./bank-classifier";
import type { PluggyTransaction } from "./types";

const tx = (partial: Partial<PluggyTransaction>): PluggyTransaction => ({
  id: crypto.randomUUID(),
  accountId: "bank",
  amount: 100,
  type: "CREDIT",
  ...partial,
});

test("rendimento estruturado de aplicação é receita financeira", () => {
  const value = classifyBankTransaction(
    tx({ operationType: "RENDIMENTO_APLIC_FINANCEIRA" }),
  );
  assert.equal(value.bank_direction, "inflow");
  assert.equal(value.financial_nature, "investment_income");
  assert.equal(value.financial_role, "revenue");
  assert.equal(value.classification_source, "provider_structured");
  assert.equal(value.classification_version, BANK_CLASSIFIER_VERSION);
});

test("aplicação debitada e resgate creditado são principal, não resultado", () => {
  const application = classifyBankTransaction(
    tx({ type: "DEBIT", amount: -500, operationType: "APLICACAO_FINANCEIRA" }),
  );
  const redemption = classifyBankTransaction(
    tx({ operationType: "RESGATE_APLIC_FINANCEIRA" }),
  );
  assert.equal(application.financial_nature, "investment_application");
  assert.equal(application.financial_role, "investment_principal");
  assert.equal(redemption.financial_nature, "investment_redemption");
  assert.equal(redemption.financial_role, "investment_principal");
});

test("operação de crédito usa CREDIT para liberação e DEBIT para prestação", () => {
  const proceeds = classifyBankTransaction(
    tx({
      operationType: "OPERACAO_CREDITO",
      description: "Liberação de crédito",
    }),
  );
  const installment = classifyBankTransaction(
    tx({
      type: "DEBIT",
      amount: -1403.75,
      operationType: "OPERACAO_CREDITO",
      description: "OPERACOES CREDITO IMOBILIARIO PREST CR IM",
    }),
  );
  assert.equal(proceeds.financial_nature, "loan_proceeds");
  assert.equal(proceeds.financial_role, "debt_proceeds");
  assert.equal(installment.bank_direction, "outflow");
  assert.equal(installment.financial_nature, "financing_payment");
  assert.equal(installment.financial_role, "debt_payment");
  assert.equal(installment.transaction_type, "expense");
});

test("type estruturado prevalece sobre descrição e conflito de sinal reduz confiança", () => {
  const debit = classifyBankTransaction(
    tx({
      type: "DEBIT",
      amount: 1403.75,
      description: "OPERACOES CREDITO IMOBILIARIO PREST CR IM",
    }),
  );
  assert.equal(debit.bank_direction, "outflow");
  assert.equal(debit.transaction_type, "expense");
  assert.equal(debit.classification_confidence, "medium");
  assert.match(debit.classification_rule, /type_sign_conflict/);
  assert.equal(providerBankDirection({ type: "CREDIT", amount: -10 }), "inflow");
});

test("Pix externo entra no resultado e par próprio vira transferência", () => {
  const external = classifyBankTransaction(
    tx({ operationType: "PIX", description: "Pix recebido" }),
  );
  const internal = classifyBankTransaction(
    tx({ operationType: "PIX", description: "Pix recebido" }),
    { internalTransfer: true },
  );
  const sent = classifyBankTransaction(
    tx({ type: "DEBIT", amount: -230, operationType: "PIX" }),
  );
  assert.equal(external.financial_nature, "pix_received");
  assert.equal(external.financial_role, "revenue");
  assert.equal(external.review_status, "reviewed");
  assert.equal(internal.financial_nature, "transfer_internal");
  assert.equal(internal.financial_role, "transfer");
  assert.equal(sent.financial_nature, "pix_sent");
  assert.equal(sent.financial_role, "expense");
});

test("salário, tarifa e estorno mantêm naturezas independentes", () => {
  assert.equal(
    classifyBankTransaction(tx({ description: "CREDITO DE SALARIO" }))
      .financial_nature,
    "salary",
  );
  assert.equal(
    classifyBankTransaction(
      tx({ type: "DEBIT", amount: -20, description: "Tarifa bancária" }),
    ).financial_nature,
    "fee",
  );
  assert.equal(
    classifyBankTransaction(tx({ description: "Estorno de compra" }))
      .financial_role,
    "correction",
  );
});

test("pagamento Santander descrito como cartão de crédito é pagamento de fatura", () => {
  const payment = classifyBankTransaction(
    tx({
      type: "DEBIT",
      amount: -11517.22,
      description:
        "PAGAMENTO CARTAO CREDITO BCE 04/07 12:47 CARTAO MASTER",
    }),
  );
  assert.equal(payment.bank_direction, "outflow");
  assert.equal(payment.financial_nature, "invoice_payment");
  assert.equal(payment.financial_role, "cash_flow_only");
  assert.equal(payment.transaction_role, "invoice_payment");
  assert.equal(payment.financial_origin, "invoice");
});

test("abreviação PGTO também identifica pagamento da fatura", () => {
  const payment = classifyBankTransaction(tx({
    type: "DEBIT", amount: -5000,
    description: "PGTO FATURA CARTAO MASTER",
  }));
  assert.equal(payment.transaction_role, "invoice_payment");
  assert.equal(payment.bank_direction, "outflow");
});
