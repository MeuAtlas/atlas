import assert from "node:assert/strict";
import test from "node:test";
import { deriveFinancialEntitlements, summarizeFinancialEntitlements } from "./financial-entitlements";

const base = { importId: "import", contractualBase: "BSB", duties: [], mealMainDiemCents: 10995, breakfastPercent: 25, internationalMeal: null, madrugadaTransportCents: 2500, hotelWaivedLocations: new Set<string>(), breakfastStillDueLocations: new Set<string>() };
const presence = (startAt: string, endAt: string, location = "RBR", country = "BR", timezone = "America/Rio_Branco") => ({ id: "presence", contextId: "duty-1", startAt, endAt, location, country, timezone });
const hotel = (location = "RBR", hotelUsed: "TRUE" | "FALSE" = "TRUE", hotelWaived: "TRUE" | "FALSE" = "FALSE") => ({ id: `hotel:${location}`, startAt: "2026-08-05T08:00:00.000Z", endAt: "2026-08-05T12:00:00.000Z", location, hotelUsed, hotelWaived });

test("derives domestic breakfast with exact integer cents when hotel breakfast is false", () => {
  const items = deriveFinancialEntitlements({ ...base, hotelWaivedLocations: new Set(["RBR"]), breakfastStillDueLocations: new Set(["RBR"]), hotelIntervals: [hotel("RBR", "FALSE", "TRUE")], presences: [presence("2026-08-05T09:00:00.000Z", "2026-08-05T14:00:00.000Z")] });
  const breakfast = items.find(item => item.entitlementType === "DOMESTIC_BREAKFAST");
  assert.equal(breakfast?.eligibilityStatus, "ELIGIBLE"); assert.equal(breakfast?.amountMinorUnits, 2749); assert.equal(breakfast?.currency, "BRL");
});
test("does not apply hotel status outside a documented hotel interval", () => {
  const items = deriveFinancialEntitlements({ ...base, presences: [presence("2026-08-05T09:00:00.000Z", "2026-08-05T14:00:00.000Z")] });
  assert.equal(items.find(item => item.entitlementType === "DOMESTIC_BREAKFAST")?.eligibilityStatus, "ELIGIBLE");
});
test("does not pay breakfast documented as included by hotel", () => {
  const items = deriveFinancialEntitlements({ ...base, hotelIntervals: [hotel()], presences: [presence("2026-08-05T09:00:00.000Z", "2026-08-05T14:00:00.000Z")] });
  assert.equal(items.find(item => item.entitlementType === "DOMESTIC_BREAKFAST")?.eligibilityStatus, "NOT_ELIGIBLE");
});
test("applies hotel-used breakfast policy at any airport, while any documented waiver remains due", () => {
  const used = deriveFinancialEntitlements({ ...base, hotelIntervals: [hotel("FOR")], presences: [presence("2026-08-05T09:00:00.000Z", "2026-08-05T14:00:00.000Z", "FOR", "BR", "America/Belem")] });
  assert.equal(used.find(item => item.entitlementType === "DOMESTIC_BREAKFAST")?.eligibilityStatus, "NOT_ELIGIBLE");
  const waived = deriveFinancialEntitlements({ ...base, hotelWaivedLocations: new Set(["FOR"]), breakfastStillDueLocations: new Set(["FOR"]), hotelIntervals: [hotel("FOR", "FALSE", "TRUE")], presences: [presence("2026-08-05T09:00:00.000Z", "2026-08-05T14:00:00.000Z", "FOR", "BR", "America/Belem")] });
  assert.equal(waived.find(item => item.entitlementType === "DOMESTIC_BREAKFAST")?.eligibilityStatus, "ELIGIBLE");
});
test("creates one entitlement per meal window and local date despite overlapping activities", () => {
  const items = deriveFinancialEntitlements({ ...base, presences: [presence("2026-08-05T14:30:00.000Z", "2026-08-06T06:30:00.000Z"), { ...presence("2026-08-05T15:00:00.000Z", "2026-08-05T16:00:00.000Z"), id: "same-window" }] });
  assert.equal(items.filter(item => item.entitlementType === "DOMESTIC_LUNCH" && item.entitlementDate === "2026-08-05").length, 1);
  assert.equal(items.filter(item => item.entitlementType === "DOMESTIC_DINNER" && item.entitlementDate === "2026-08-05").length, 1);
  assert.equal(items.filter(item => item.entitlementType === "DOMESTIC_SUPPER" && item.entitlementDate === "2026-08-05").length, 1);
});
test("deduplicates a meal window shared by duty and trip contexts", () => {
  const items = deriveFinancialEntitlements({ ...base, presences: [presence("2026-08-05T16:00:00.000Z", "2026-08-05T18:00:00.000Z"), { ...presence("2026-08-05T16:00:00.000Z", "2026-08-05T18:00:00.000Z"), id: "trip", contextId: "trip:duty-1:duty-2" }] });
  assert.equal(items.filter(item => item.entitlementType === "DOMESTIC_LUNCH").length, 1);
});
test("uses the documented MIA international rate without BRL conversion", () => {
  const known = deriveFinancialEntitlements({ ...base, internationalMeal: { currency: "USD", amountMinorUnits: 4500, parameterId: "INTL_MEAL" }, presences: [presence("2026-08-05T15:00:00.000Z", "2026-08-05T19:00:00.000Z", "MIA", "US", "America/New_York")] });
  assert.equal(known.find(item => item.entitlementType === "INTERNATIONAL_LUNCH")?.currency, "USD"); assert.equal(known.find(item => item.entitlementType === "INTERNATIONAL_LUNCH")?.amountMinorUnits, 2500);
});
test("uses local duty boundaries for madrugada transport", () => {
  const at0559 = deriveFinancialEntitlements({ ...base, presences: [], duties: [{ id: "duty-1", presentationAt: "2026-08-05T08:59:00.000Z", releaseAt: null, startAirport: "BSB", endAirport: null, startTimezone: "America/Sao_Paulo", endTimezone: null }] });
  assert.equal(at0559[0]?.eligibilityStatus, "ELIGIBLE");
  const at0600 = deriveFinancialEntitlements({ ...base, presences: [], duties: [{ id: "duty-1", presentationAt: "2026-08-05T09:00:00.000Z", releaseAt: null, startAirport: "BSB", endAirport: null, startTimezone: "America/Sao_Paulo", endTimezone: null }] });
  assert.equal(at0600.length, 0);
  const atMidnight = deriveFinancialEntitlements({ ...base, presences: [], duties: [{ id: "duty-1", presentationAt: null, releaseAt: "2026-08-05T03:00:00.000Z", startAirport: null, endAirport: "BSB", startTimezone: null, endTimezone: "America/Sao_Paulo" }] });
  assert.equal(atMidnight[0]?.eligibilityStatus, "ELIGIBLE");
});
test("keeps a chosen foreign daily window independent from BRL conversion", () => {
  const items = deriveFinancialEntitlements({ ...base, internationalMeal: { currency: "USD", amountMinorUnits: 1000, parameterId: "INTL" }, presences: [presence("2026-08-05T16:00:00.000Z", "2026-08-05T18:00:00.000Z"), presence("2026-08-05T15:00:00.000Z", "2026-08-05T19:00:00.000Z", "MIA", "US", "America/New_York")] });
  const summary = summarizeFinancialEntitlements(items); assert.equal(summary.BRL?.knownMinorUnits ?? 0, 0); assert.equal(summary.USD?.knownMinorUnits, 2500);
});
test("builds a daily lunch row from training even without an operating leg", () => {
  const items = deriveFinancialEntitlements({ ...base, periodStart: "2026-08-02", periodEnd: "2026-08-02", activities: [{ ...presence("2026-08-02T11:30:00.000Z", "2026-08-02T16:00:00.000Z", "BSB", "BR", "America/Sao_Paulo"), kind: "TRAINING" }] });
  const lunch = items.find(item => item.entitlementType === "DOMESTIC_LUNCH");
  assert.equal(lunch?.eligibilityStatus, "ELIGIBLE"); assert.equal(lunch?.reason, "ELIGIBLE_TRAINING_OVERLAP");
  assert.equal(items.filter(item => item.entitlementType.startsWith("DOMESTIC_")).length, 4);
});
test("marks a deadhead dinner outside base as eligible", () => {
  const items = deriveFinancialEntitlements({ ...base, periodStart: "2026-08-03", periodEnd: "2026-08-03", activities: [{ ...presence("2026-08-03T21:33:00.000Z", "2026-08-03T23:15:00.000Z", "CGH", "BR", "America/Sao_Paulo"), kind: "DEADHEAD" }] });
  const dinner = items.find(item => item.entitlementType === "DOMESTIC_DINNER");
  assert.equal(dinner?.eligibilityStatus, "ELIGIBLE"); assert.equal(dinner?.reason, "ELIGIBLE_DEADHEAD_OVERLAP");
});
test("treats standby as company disposal and does not exclude service at the contractual base", () => {
  const items = deriveFinancialEntitlements({ ...base, periodStart: "2026-08-11", periodEnd: "2026-08-11", activities: [{ ...presence("2026-08-11T12:00:00.000Z", "2026-08-11T21:10:00.000Z", "BSB", "BR", "America/Sao_Paulo"), kind: "STANDBY" }] });
  const lunch = items.find(item => item.entitlementType === "DOMESTIC_LUNCH");
  assert.equal(lunch?.eligibilityStatus, "ELIGIBLE"); assert.equal(lunch?.reason, "ELIGIBLE_STANDBY_OVERLAP");
});
test("only blocks breakfast while its documented hotel interval overlaps", () => {
  const duringHotel = deriveFinancialEntitlements({ ...base, hotelIntervals: [hotel("RBR")], activities: [{ ...presence("2026-08-05T09:00:00.000Z", "2026-08-05T14:00:00.000Z"), kind: "OPERATING" }] });
  const afterHotel = deriveFinancialEntitlements({ ...base, hotelIntervals: [{ ...hotel("RBR"), endAt: "2026-08-05T08:30:00.000Z" }], activities: [{ ...presence("2026-08-05T09:00:00.000Z", "2026-08-05T14:00:00.000Z"), kind: "OPERATING" }] });
  assert.equal(duringHotel.find(item => item.entitlementType === "DOMESTIC_BREAKFAST")?.eligibilityStatus, "NOT_ELIGIBLE"); assert.equal(afterHotel.find(item => item.entitlementType === "DOMESTIC_BREAKFAST")?.eligibilityStatus, "ELIGIBLE");
});
test("uses documented international group rates and breakfast quarter", () => {
  const europe = deriveFinancialEntitlements({ ...base, activities: [{ ...presence("2026-08-06T05:00:00.000Z", "2026-08-06T12:00:00.000Z", "CDG", "FR", "Europe/Paris"), kind: "OPERATING", internationalDiemRateGroup: "EUROPE" }] });
  const uk = deriveFinancialEntitlements({ ...base, activities: [{ ...presence("2026-08-06T05:00:00.000Z", "2026-08-06T12:00:00.000Z", "LHR", "GB", "Europe/London"), kind: "OPERATING", internationalDiemRateGroup: "UNITED_KINGDOM" }] });
  const southAmerica = deriveFinancialEntitlements({ ...base, activities: [{ ...presence("2026-08-06T08:00:00.000Z", "2026-08-06T18:00:00.000Z", "EZE", "AR", "America/Argentina/Buenos_Aires"), kind: "OPERATING", internationalDiemRateGroup: "SOUTH_AMERICA" }] });
  assert.equal(europe.find(item => item.entitlementType === "INTERNATIONAL_BREAKFAST")?.amountMinorUnits, 575); assert.equal(europe.find(item => item.entitlementType === "INTERNATIONAL_LUNCH")?.amountMinorUnits, 2300);
  assert.equal(uk.find(item => item.entitlementType === "INTERNATIONAL_BREAKFAST")?.amountMinorUnits, 575); assert.equal(uk.find(item => item.entitlementType === "INTERNATIONAL_LUNCH")?.currency, "GBP");
  assert.equal(southAmerica.find(item => item.entitlementType === "INTERNATIONAL_BREAKFAST")?.amountMinorUnits, 525); assert.equal(southAmerica.find(item => item.entitlementType === "INTERNATIONAL_LUNCH")?.amountMinorUnits, 2100);
});
