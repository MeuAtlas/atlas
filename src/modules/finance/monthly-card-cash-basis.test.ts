import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const query = readFileSync("src/modules/finance/monthly-financial-report-query.ts", "utf8");
const report = readFileSync("src/modules/finance/monthly-financial-report.ts", "utf8");
const view = readFileSync("src/components/finance/monthly-report-view.tsx", "utf8");
const pdf = readFileSync("src/modules/finance/monthly-financial-report-pdf.ts", "utf8");

test("faturas pagas pertencem ao mês da data do pagamento", () => {
  assert.match(query, /credit_card_statement_payments/);
  assert.match(query, /\.gte\("payment_date", period\.startDate\)\.lt\("payment_date", period\.endExclusiveDate\)/);
  assert.match(report, /cashCardOutflow: cardCashSummary\.grossCardPayment/);
  assert.match(query, /unmatchedCardPayments/);
});

test("fatura aberta fica separada como previsão do próximo mês", () => {
  assert.match(query, /const openStatements/);
  assert.match(query, /String\(row\.due_date\) >= period\.endExclusiveDate/);
  assert.match(view, /Ela não é uma saída deste mês/);
});

test("PDF da fatura é opcional e não bloqueia fechamento", () => {
  assert.doesNotMatch(report, /statement_pdf_missing[\s\S]{0,200}severity: "blocking"/);
  assert.match(report, /statement_pdf_optional/);
  assert.match(view, /Anexar PDF da fatura/);
  assert.match(view, /Opcional/);
});

test("anexo bancário preserva pagamento real sem saída sintética", () => {
  assert.match(report, /bankMovements/);
  assert.match(pdf, /input\.snapshot\.bankMovements/);
  assert.match(pdf, /Valor da fatura confirmado pelo pagamento identificado na conta corrente/);
});

test("snapshots concluídos continuam imutáveis e usam nova versão ao reabrir", () => {
  const migration = readFileSync("supabase/migrations/202608020076_monthly_financial_reports.sql", "utf8");
  assert.match(migration, /protect_final_monthly_report/);
  assert.match(migration, /Reabra o mês antes de gerar uma nova versão/);
});
