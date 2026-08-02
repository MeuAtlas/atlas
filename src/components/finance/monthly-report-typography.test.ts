import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const styles = readFileSync("src/app/globals.css", "utf8");

test("relatório mensal usa a escala tipográfica legível do Financeiro", () => {
  assert.match(styles, /\.monthly-report-page\{font-size:16px\}/);
  assert.match(styles, /\.monthly-report-page \.monthly-summary span\{font-size:13px/);
  assert.match(styles, /\.monthly-report-page \.monthly-summary small\{font-size:12px/);
  assert.match(styles, /\.monthly-report-page \.statement-card h3\{font-size:16px/);
  assert.match(styles, /\.monthly-report-page \.monthly-attention small\{font-size:13px/);
  assert.match(styles, /\.monthly-report-page \.monthly-close-box form p\{font-size:13px/);
});
