import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const route = readFileSync("src/app/auth/login/route.ts", "utf8");
const loginCard = readFileSync("src/components/auth/login-card.tsx", "utf8");

test("login has a native POST fallback that works before React hydration", () => {
  assert.match(loginCard, /action="\/auth\/login"/);
  assert.match(loginCard, /method="post"/);
  assert.match(loginCard, /name="email"/);
  assert.match(loginCard, /name="password"/);
  assert.match(loginCard, /auth\.signInWithPassword/);
  assert.match(loginCard, /navigate\("\/auth\/continue", "replace"\)/);
  assert.match(route, /export async function POST/);
  assert.match(route, /auth\.signInWithPassword/);
  assert.match(route, /redirectTo\("\/auth\/continue"\)/);
});

test("login redirects relatively with 303 and never exposes the provider error", () => {
  assert.match(route, /status: 303/);
  assert.match(route, /headers: \{ Location: path \}/);
  assert.doesNotMatch(route, /new URL\([^\n]*request\.url/);
  assert.match(route, /"invalid_credentials"/);
  assert.match(route, /"email_not_confirmed"/);
  assert.match(loginCard, /Seu e-mail ainda não foi confirmado/);
  assert.match(route, /"rate_limited"/);
  assert.match(route, /"unavailable"/);
  assert.doesNotMatch(route, /error\.message[^\n]*searchParams/);
});
