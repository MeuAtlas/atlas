import assert from "node:assert/strict";
import test from "node:test";
import { PluggyApiError } from "./errors";
import {
  buildPluggyTransactionsUrl,
  listAllPluggyTransactions,
  normalizePluggyTransactionsPage,
  PluggyTransactionsPaginationError,
} from "./transactions-pagination";
import type { PluggyTransaction } from "./types";

const transaction = (id: string): PluggyTransaction => ({
  id,
  accountId: "account-1",
  amount: -10,
  date: "2026-08-03T10:00:00Z",
});

test("builder inclui apenas accountId na URL básica", () => {
  const url = buildPluggyTransactionsUrl({ accountId: "account 1" });
  assert.equal(url, "/v2/transactions?accountId=account+1");
  assert.doesNotMatch(url, /(?:[?&])page=/);
  assert.doesNotMatch(url, /(?:[?&])pageSize=/);
  assert.doesNotMatch(url, /(?:[?&])after=/);
});

test("builder inclui intervalo sem paginação por página", () => {
  const url = buildPluggyTransactionsUrl({
    accountId: "account-1",
    dateFrom: "2026-07-20",
    dateTo: "2026-08-03",
  });
  assert.match(url, /accountId=account-1/);
  assert.match(url, /dateFrom=2026-07-20/);
  assert.match(url, /dateTo=2026-08-03/);
  assert.doesNotMatch(url, /(?:[?&])page(?:Size)?=/);
});

test("builder codifica cursor e nunca inclui page ou pageSize", () => {
  const url = buildPluggyTransactionsUrl({
    accountId: "account-1",
    after: "cursor+/=? &fim",
  });
  assert.equal(
    new URL(url, "https://api.pluggy.ai").searchParams.get("after"),
    "cursor+/=? &fim",
  );
  assert.doesNotMatch(url, /(?:[?&])page(?:Size)?=/);
});

test("builder exige accountId e rejeita parâmetros desconhecidos", () => {
  assert.throws(
    () => buildPluggyTransactionsUrl({ accountId: "" }),
    (error: unknown) => error instanceof PluggyTransactionsPaginationError &&
      error.code === "pluggy_transactions_account_required",
  );
  assert.throws(
    () => buildPluggyTransactionsUrl({
      accountId: "account-1",
      pageSize: 500,
    } as never),
    (error: unknown) => error instanceof PluggyTransactionsPaginationError &&
      error.code === "pluggy_transactions_unknown_parameter",
  );
});

test("normalizador usa results e extrai after do next real", () => {
  const page = normalizePluggyTransactionsPage({
    results: [transaction("tx-1")],
    next: "?accountId=account-1&after=cursor%2B%2F%3D",
  });
  assert.deepEqual(page.results.map(row => row.id), ["tx-1"]);
  assert.equal(page.nextCursor, "cursor+/=");
  assert.equal(
    normalizePluggyTransactionsPage({ results: [] }).nextCursor,
    null,
  );
});

test("normalizador rejeita payload sem results array", () => {
  assert.throws(
    () => normalizePluggyTransactionsPage({ results: null }),
    (error: unknown) => error instanceof PluggyTransactionsPaginationError &&
      error.code === "pluggy_transactions_invalid_payload",
  );
});

test("coletor conclui uma página", async () => {
  const result = await listAllPluggyTransactions(
    { accountId: "account-1" },
    async () => ({ results: [transaction("tx-1")] }),
  );
  assert.equal(result.pagesFetched, 1);
  assert.equal(result.completed, true);
  assert.deepEqual(result.transactions.map(row => row.id), ["tx-1"]);
  assert.deepEqual(result.cursorsUsed, []);
});

test("coletor percorre duas páginas usando after", async () => {
  const requests: string[] = [];
  const result = await listAllPluggyTransactions(
    { accountId: "account-1" },
    async input => {
      requests.push(buildPluggyTransactionsUrl(input));
      return input.after
        ? { results: [transaction("tx-2")] }
        : {
            results: [transaction("tx-1")],
            next: "?accountId=account-1&after=cursor-2",
          };
    },
  );
  assert.equal(result.pagesFetched, 2);
  assert.deepEqual(result.transactions.map(row => row.id), ["tx-1", "tx-2"]);
  assert.doesNotMatch(requests.join("\n"), /(?:[?&])page(?:Size)?=/);
  assert.doesNotMatch(requests[0], /(?:[?&])after=/);
  assert.match(requests[1], /(?:[?&])after=cursor-2/);
});

test("coletor interrompe cursor repetido", async () => {
  await assert.rejects(
    () => listAllPluggyTransactions(
      { accountId: "account-1" },
      async () => ({
        results: [transaction("tx-1")],
        next: "cursor-2",
      }),
    ),
    (error: unknown) => error instanceof PluggyTransactionsPaginationError &&
      error.code === "pluggy_pagination_repeated_cursor" &&
      error.pagesFetched === 2,
  );
});

test("falha na segunda página preserva métricas e causa do provedor", async () => {
  await assert.rejects(
    () => listAllPluggyTransactions(
      { accountId: "account-1" },
      async input => {
        if (!input.after) return {
          results: [transaction("tx-1")],
          next: "cursor-2",
        };
        throw new PluggyApiError("provider unavailable", {
          status: 503,
          code: "PROVIDER_UNAVAILABLE",
          operation: "GET /v2/transactions",
          providerMessage: "provider unavailable",
        });
      },
    ),
    (error: unknown) => error instanceof PluggyTransactionsPaginationError &&
      error.code === "pluggy_transactions_page_failed" &&
      error.pagesFetched === 1 &&
      error.partialTransactions.length === 1 &&
      error.status === 503 &&
      error.providerMessage === "provider unavailable",
  );
});

test("limite máximo impede loop infinito", async () => {
  await assert.rejects(
    () => listAllPluggyTransactions(
      { accountId: "account-1" },
      async input => ({
        results: [transaction(input.after ? "tx-2" : "tx-1")],
        next: input.after ? "cursor-3" : "cursor-2",
      }),
      1,
    ),
    (error: unknown) => error instanceof PluggyTransactionsPaginationError &&
      error.code === "pluggy_pagination_limit" &&
      error.pagesFetched === 1,
  );
});
