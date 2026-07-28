import assert from "node:assert/strict";
import test from "node:test";
import {
  logSupabaseError,
  normalizeError,
  normalizeSupabaseError,
} from "./errors";

test("normaliza objetos PostgREST sem devolvê-los à interface", () => {
  assert.deepEqual(
    normalizeError({ code: "PGRST201", message: "ambiguous relationship", details: "internal", hint: "use a relationship hint" }),
    { code: "PGRST201", message: "ambiguous relationship" },
  );
});

test("normaliza valores desconhecidos com mensagem segura", () => {
  assert.deepEqual(normalizeError({ details: "internal" }), { message: "Ocorreu um erro inesperado.", code: undefined });
});

test("normaliza campos PostgREST mesmo quando não são enumeráveis", () => {
  const error = new Error("Could not find a relationship");
  Object.defineProperties(error, {
    code: { value: "PGRST200", enumerable: false },
    details: { value: "relationship hint not found", enumerable: false },
    hint: { value: "Use the generated foreign key name", enumerable: false },
    status: { value: 400, enumerable: false },
  });
  assert.deepEqual(
    normalizeSupabaseError(error, "getMovementsData.card_purchases"),
    {
      context: "getMovementsData.card_purchases",
      name: "Error",
      code: "PGRST200",
      message: "Could not find a relationship",
      details: "relationship hint not found",
      hint: "Use the generated foreign key name",
      status: 400,
      cause: null,
      rawType: "Error",
    },
  );
});

test("logger registra diagnóstico estruturado em vez de objeto vazio", () => {
  const calls: unknown[][] = [];
  const original = console.error;
  console.error = (...values: unknown[]) => calls.push(values);
  try {
    logSupabaseError(
      {
        code: "42P01",
        message: "relation does not exist",
        details: "schema cache",
        hint: "apply migration",
      },
      "getMovementsData.card_purchases",
    );
  } finally {
    console.error = original;
  }
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], "[Atlas Supabase Error]");
  assert.deepEqual(calls[0][1], {
    context: "getMovementsData.card_purchases",
    name: null,
    code: "42P01",
    message: "relation does not exist",
    details: "schema cache",
    hint: "apply migration",
    status: null,
    cause: null,
    rawType: "Object",
  });
  assert.notDeepEqual(calls[0][1], {});
});
