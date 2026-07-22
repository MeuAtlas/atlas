import assert from "node:assert/strict";
import test from "node:test";
import { normalizeError } from "./errors";

test("normaliza objetos PostgREST sem devolvê-los à interface", () => {
  assert.deepEqual(
    normalizeError({ code: "PGRST201", message: "ambiguous relationship", details: "internal", hint: "use a relationship hint" }),
    { code: "PGRST201", message: "ambiguous relationship" },
  );
});

test("normaliza valores desconhecidos com mensagem segura", () => {
  assert.deepEqual(normalizeError({ details: "internal" }), { message: "Ocorreu um erro inesperado.", code: undefined });
});
