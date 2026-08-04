import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const script = readFileSync("scripts/reset-user-password.mjs", "utf8");
const packageJson = readFileSync("package.json", "utf8");

test("redefinição administrativa mantém chave e senha fora do código", () => {
  assert.match(script, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(script, /askHidden\("Nova senha/);
  assert.match(script, /auth\.admin\.updateUserById/);
  assert.match(script, /auth\.signInWithPassword/);
  assert.match(script, /Senha atualizada e login conferido com sucesso/);
  assert.match(script, /\\u0000-\\u001f/);
  assert.doesNotMatch(script, /process\.argv/);
  assert.match(packageJson, /"auth:reset-password"/);
});
