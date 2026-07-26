import assert from "node:assert/strict";
import test from "node:test";
import { mapTransaction } from "@/lib/pluggy/mappers";
import { calculateBankAccountMonthlyMovement } from "./account-movement";
import {
  calculateMonthlyFinancialResult,
  getFinanceMonthPeriod,
} from "./monthly-result";
import type {
  FinancialAccount,
  FinancialTransaction,
} from "./types";
import type { PluggyTransaction } from "@/lib/pluggy/types";

const period = getFinanceMonthPeriod({
  year: 2026,
  month: 7,
  timeZone: "America/Sao_Paulo",
});
const account: FinancialAccount = {
  id: "account",
  bank_connection_id: "connection",
  name: "Santander",
  institution_name: "Santander",
  account_type: "checking",
  current_balance: 0,
  opening_balance: 0,
  source: "pluggy",
  status: "active",
  visibility: "private",
  workspace_id: null,
  last_sync_at: "2026-07-31T12:00:00Z",
};

function mapped(partial: Partial<PluggyTransaction>) {
  return {
    ...mapTransaction(
      {
        id: crypto.randomUUID(),
        accountId: "provider-account",
        date: "2026-07-10T12:00:00Z",
        status: "POSTED",
        ...partial,
      },
      "owner",
      "connection",
      { accountId: account.id, accountType: "BANK" },
    ),
    id: crypto.randomUUID(),
    workspace_id: null,
    visibility: "private",
    destination_account_id: null,
    category_id: null,
    due_date: null,
  } as FinancialTransaction;
}

test("quatro casos reais alimentam resultado, caixa e detalhes pela mesma classificação", () => {
  const rows = [
    mapped({
      type: "CREDIT",
      amount: 75,
      operationType: "RENDIMENTO_APLIC_FINANCEIRA",
      description: "REMUNERACAO APLIC AUTOMATICA",
    }),
    mapped({
      type: "DEBIT",
      amount: 1403.75,
      operationType: "OPERACAO_CREDITO",
      description: "OPERACOES CREDITO IMOBILIARIO PREST CR IM",
    }),
    mapped({
      type: "CREDIT",
      amount: 230,
      operationType: "PIX",
      description: "PIX RECEBIDO",
      date: "2026-07-03T12:00:00Z",
    }),
    mapped({
      type: "CREDIT",
      amount: 10_816.04,
      description: "CREDITO DE SALARIO",
      date: "2026-07-04T12:00:00Z",
    }),
  ];
  const result = calculateMonthlyFinancialResult({
    transactions: rows,
    purchases: [],
    period,
  });
  const movement = calculateBankAccountMonthlyMovement({
    account,
    transactions: rows,
    period,
  });

  assert.equal(result.realizedRevenue, 11_121.04);
  assert.equal(result.realizedExpenses, 1_403.75);
  assert.equal(result.entries.length, 4);
  assert.equal(movement.totalInflow, 11_121.04);
  assert.equal(movement.totalOutflow, 1_403.75);
  assert.equal(
    rows.find((row) => row.financial_nature === "salary")?.competence_date,
    "2026-07-04",
  );
});

test("aplicação, resgate e empréstimo afetam caixa sem contaminar resultado", () => {
  const rows = [
    mapped({
      type: "DEBIT",
      amount: -500,
      operationType: "APLICACAO_FINANCEIRA",
    }),
    mapped({
      type: "CREDIT",
      amount: 600,
      operationType: "RESGATE_APLIC_FINANCEIRA",
    }),
    mapped({
      type: "CREDIT",
      amount: 2_000,
      operationType: "OPERACAO_CREDITO",
      description: "LIBERACAO DE CREDITO",
    }),
  ];
  const result = calculateMonthlyFinancialResult({
    transactions: rows,
    purchases: [],
    period,
  });
  const movement = calculateBankAccountMonthlyMovement({
    account,
    transactions: rows,
    period,
  });
  assert.equal(result.realizedRevenue, 0);
  assert.equal(result.realizedExpenses, 0);
  assert.equal(movement.totalInflow, 2_600);
  assert.equal(movement.totalOutflow, 500);
});
