import assert from "node:assert/strict";
import test from "node:test";
import {
  defaultLogger,
  requireQuery,
  sanitizeError,
  withQueryFallback,
  type QueryWarning,
} from "./query-fallback";

const silent = () => undefined;

test("consulta opcional usa fallback e preserva diagnóstico sanitizado", async () => {
  const diagnostics: QueryWarning[] = [];
  const result = await withQueryFallback(
    "card_sync_diagnostics",
    Promise.resolve({
      data: null,
      error: {
        code: "42P01",
        message: "relation does not exist",
        details: "schema cache",
        hint: "apply migration",
        privatePayload: { amount: 6007.21 },
      },
    }),
    [],
    (_label, diagnostic) => diagnostics.push(diagnostic),
  );

  assert.deepEqual(result.data, []);
  assert.equal(result.warning?.code, "42P01");
  assert.deepEqual(diagnostics, [
    {
      query: "card_sync_diagnostics",
      name: undefined,
      code: "42P01",
      message: "relation does not exist",
      details: "schema cache",
      hint: "apply migration",
      status: undefined,
      stack: undefined,
    },
  ]);
  assert.equal("privatePayload" in diagnostics[0], false);
});

test("consulta opcional vazia não é tratada como falha", async () => {
  const result = await withQueryFallback(
    "financial_sync_runs",
    Promise.resolve({ data: [], error: null }),
    [{ id: "fallback" }],
    silent,
  );

  assert.deepEqual(result, { data: [], warning: null });
});

test("cada seção opcional falha isoladamente sem impedir as demais", async () => {
  for (const query of [
    "provider_incidents",
    "financial_sync_runs",
    "credit_card_instruments",
    "card_sync_metrics",
    "card_sync_diagnostics",
  ]) {
    const result = await withQueryFallback(
      query,
      Promise.resolve({
        data: null,
        error: { code: "42703", message: "column does not exist" },
      }),
      [],
      silent,
    );

    assert.deepEqual(result.data, []);
    assert.equal(result.warning?.query, query);
  }
});

test("todas as consultas válidas preservam seus próprios resultados", async () => {
  const results = await Promise.all(
    ["history", "instruments", "diagnostics"].map((query) =>
      withQueryFallback(
        query,
        Promise.resolve({ data: [{ query }], error: null }),
        [],
        silent,
      ),
    ),
  );

  assert.deepEqual(
    results.map((result) => result.data[0].query),
    ["history", "instruments", "diagnostics"],
  );
  assert.ok(results.every((result) => result.warning === null));
});

test("falha opcional lançada também mantém a página disponível", async () => {
  const result = await withQueryFallback(
    "card_sync_metrics",
    Promise.reject(new Error("timeout")),
    0,
    silent,
  );

  assert.equal(result.data, 0);
  assert.equal(result.warning?.message, "timeout");
});

test("falha em bank_connections continua bloqueando a página", async () => {
  await assert.rejects(
    requireQuery(
      "bank_connections",
      Promise.resolve({
        data: null,
        error: {
          code: "42501",
          message: "permission denied",
          details: null,
          hint: null,
        },
      }),
      silent,
    ),
    /bank_connections/,
  );
});

test("conexão degradada e resultado vazio são dados válidos", async () => {
  const degraded = await requireQuery(
    "bank_connections",
    Promise.resolve({
      data: [{ id: "connection", status: "error", sync_status: "warning" }],
      error: null,
    }),
    silent,
  );
  const empty = await requireQuery(
    "bank_connections",
    Promise.resolve({ data: [], error: null }),
    silent,
  );

  assert.equal(degraded[0].sync_status, "warning");
  assert.deepEqual(empty, []);
});

test("normaliza PostgrestError literal com todos os campos diagnósticos", () => {
  assert.deepEqual(
    sanitizeError("card_sync_diagnostics", {
      name: "PostgrestError",
      code: "42703",
      message: "column does not exist",
      details: "missing classification_counts",
      hint: "apply migration",
      status: 400,
      privatePayload: { amount: 6007.21 },
    }),
    {
      query: "card_sync_diagnostics",
      name: "PostgrestError",
      code: "42703",
      message: "column does not exist",
      details: "missing classification_counts",
      hint: "apply migration",
      status: 400,
      stack: undefined,
    },
  );
});

test("normaliza Error nativo mesmo com propriedades não enumeráveis", () => {
  const error = new Error("network timeout") as Error & {
    code?: string;
    details?: string;
    hint?: string;
    status?: number;
  };
  Object.defineProperties(error, {
    code: { value: "ETIMEDOUT" },
    details: { value: "socket closed" },
    hint: { value: "retry later" },
    status: { value: 504 },
  });

  const diagnostic = sanitizeError("financial_sync_runs", error);
  assert.equal(diagnostic.name, "Error");
  assert.equal(diagnostic.code, "ETIMEDOUT");
  assert.equal(diagnostic.message, "network timeout");
  assert.equal(diagnostic.details, "socket closed");
  assert.equal(diagnostic.hint, "retry later");
  assert.equal(diagnostic.status, 504);
});

test("normaliza erros string e null sem produzir objeto vazio", () => {
  assert.deepEqual(sanitizeError("provider_incidents", "offline"), {
    query: "provider_incidents",
    message: "offline",
  });
  assert.deepEqual(sanitizeError("provider_incidents", null), {
    query: "provider_incidents",
    message: "Erro desconhecido em consulta opcional.",
  });
});

test("logger opcional sempre inclui query e message", () => {
  const calls: unknown[][] = [];
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    calls.push(args);
  };

  try {
    defaultLogger(
      "[Atlas Optional Supabase Query]",
      sanitizeError("card_sync_diagnostics", {}),
    );
  } finally {
    console.warn = originalWarn;
  }

  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], "[Atlas Optional Supabase Query]");
  assert.notDeepEqual(calls[0][1], {});
  assert.equal(
    (calls[0][1] as { query: string }).query,
    "card_sync_diagnostics",
  );
  assert.match(
    (calls[0][1] as { message: string }).message,
    /falhou sem mensagem/,
  );
});
