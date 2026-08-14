import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { calculateInss, calculateIrrf, valuePersonalDeduction, type PersonalDeduction } from "./financial-payroll-deductions";
import { appliesToCompetence, competenceStart, parseBrlToCents, previousMonthEnd } from "./personal-deductions";

test("personal deduction validity preserves prior competences", () => {
  const oldVersion = { effectiveFrom: "2026-07-01", effectiveTo: "2026-08-31" };
  const newVersion = { effectiveFrom: "2026-09-01", effectiveTo: null };
  assert.equal(appliesToCompetence(oldVersion, competenceStart(2026, 7)), true);
  assert.equal(appliesToCompetence(oldVersion, competenceStart(2026, 8)), true);
  assert.equal(appliesToCompetence(oldVersion, competenceStart(2026, 9)), false);
  assert.equal(appliesToCompetence(newVersion, competenceStart(2026, 8)), false);
  assert.equal(appliesToCompetence(newVersion, competenceStart(2026, 9)), true);
  assert.equal(previousMonthEnd("2026-09-01"), "2026-08-31");
});

test("new, retroactive and ended deductions resolve by the requested competence", () => {
  const august = { effectiveFrom: "2026-08-01", effectiveTo: null };
  const retroactiveJune = { effectiveFrom: "2026-06-01", effectiveTo: null };
  const endedFromNovember = { effectiveFrom: "2026-06-01", effectiveTo: "2026-10-31" };
  assert.equal(appliesToCompetence(august, "2026-07-01"), false);
  assert.equal(appliesToCompetence(august, "2026-08-01"), true);
  assert.equal(appliesToCompetence(retroactiveJune, "2026-06-01"), true);
  assert.equal(appliesToCompetence(endedFromNovember, "2026-10-01"), true);
  assert.equal(appliesToCompetence(endedFromNovember, "2026-11-01"), false);
});

test("value and deductibility versions keep the historical row immutable", () => {
  const july = { amountMinorUnits: 60_000, deductibleFromIrrfBase: false, effectiveFrom: "2026-01-01", effectiveTo: "2026-07-31" };
  const august = { amountMinorUnits: 65_826, deductibleFromIrrfBase: true, effectiveFrom: "2026-08-01", effectiveTo: null };
  assert.equal(appliesToCompetence(july, "2026-07-01"), true);
  assert.equal(appliesToCompetence(july, "2026-08-01"), false);
  assert.equal(july.amountMinorUnits, 60_000);
  assert.equal(july.deductibleFromIrrfBase, false);
  assert.equal(appliesToCompetence(august, "2026-08-01"), true);
  assert.equal(august.amountMinorUnits, 65_826);
  assert.equal(august.deductibleFromIrrfBase, true);
});

test("BRL parser uses integer cents without unsafe floats", () => {
  assert.equal(parseBrlToCents("658,26"), 65826);
  assert.equal(parseBrlToCents("R$ 1.234,56"), 123456);
  assert.equal(parseBrlToCents("658.26"), 65826);
  assert.equal(parseBrlToCents("1,234"), null);
  assert.equal(parseBrlToCents("-1"), null);
});

test("deductible and non-deductible items are each subtracted once from net", () => {
  const gross = 1_000_000;
  const inss = calculateInss(gross).amountCents;
  const make = (deductibleFromIrrfBase: boolean): PersonalDeduction => ({ id: String(deductibleFromIrrfBase), name: "Desconto", calculationType: "FIXED", amountMinorUnits: 65_826, percentageBasisPoints: null, deductibleFromIrrfBase });
  const deductible = make(true);
  const regular = make(false);
  const deductibleIrrf = calculateIrrf(gross, inss, [deductible]);
  const regularIrrf = calculateIrrf(gross, inss, [regular]);
  assert.equal(valuePersonalDeduction(deductible), 65_826);
  assert.equal(gross - inss - deductibleIrrf.amountCents - valuePersonalDeduction(deductible), gross - inss - deductibleIrrf.amountCents - 65_826);
  assert.equal(gross - inss - regularIrrf.amountCents - valuePersonalDeduction(regular), gross - inss - regularIrrf.amountCents - 65_826);
  assert.ok(deductibleIrrf.amountCents <= regularIrrf.amountCents);
});

test("modal, API and migration enforce the temporal and owner-safe workflow", () => {
  const modal = readFileSync("src/components/flight/personal-deductions-dialog.tsx", "utf8");
  const api = readFileSync("src/app/api/flight-payroll-deductions/route.ts", "utf8");
  const service = readFileSync("src/modules/flight/financial/personal-deduction-service.ts", "utf8");
  const taxService = readFileSync("src/modules/flight/financial/financial-payroll-deductions-service.ts", "utf8");
  const migration = readFileSync("supabase/migrations/202608140100_flight_personal_deduction_versions.sql", "utf8");
  assert.match(modal, /AtlasModal/);
  assert.match(modal, /Configurar descontos pessoais/);
  assert.match(modal, /action: view\.kind === "edit" \? "version"/);
  assert.match(modal, /action: "end"/);
  assert.match(api, /eq\("user_id", user\.id\)/);
  assert.match(api, /calculationType !== "FIXED"/);
  assert.match(service, /refreshGross: false/);
  assert.match(api, /recalculatePersonalDeductionsFromCompetence/);
  assert.doesNotMatch(taxService, /eq\("active", true\)/);
  assert.match(migration, /exclude using gist/);
  assert.match(migration, /auth\.uid\(\)/);
  assert.match(migration, /for update/);
  assert.match(migration, /effective_to = \(p_effective_from - interval '1 day'\)/);
});
