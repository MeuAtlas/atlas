import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sql = readFileSync("supabase/migrations/202608020079_monthly_report_analytics.sql", "utf8");
const query = readFileSync("src/modules/finance/monthly-financial-report-query.ts", "utf8");

test("migration materializa perspectivas sem tornar o snapshot editável pelo cliente", () => {
  assert.match(sql, /total_real_income/);
  assert.match(sql, /personal_card_consumption/);
  assert.match(sql, /income_history_month_count/);
  assert.match(sql, /hydrate_monthly_report_analytics/);
  assert.doesNotMatch(sql, /create policy[^\n]*monthly_financial_reports[^\n]*for update/i);
});

test("relatório concluído lê o snapshot corrente congelado", () => {
  assert.match(query, /status === "closed" && currentReport\?\.snapshot_json/);
  assert.match(query, /currentReport\.snapshot_json\s*:\s*liveSnapshot/);
});
