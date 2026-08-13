import { createHash } from "node:crypto";
import { localAtUtc, type InternationalDiemRateGroup } from "@/modules/flight/time-metrics";

export const FLIGHT_FINANCIAL_ENTITLEMENTS_VERSION = "flight-financial-entitlements/2.1.0";

export type EntitlementType = "DOMESTIC_BREAKFAST" | "DOMESTIC_LUNCH" | "DOMESTIC_DINNER" | "DOMESTIC_SUPPER" | "INTERNATIONAL_BREAKFAST" | "INTERNATIONAL_LUNCH" | "INTERNATIONAL_DINNER" | "INTERNATIONAL_SUPPER" | "MADRUGADA_TRANSPORT_REIMBURSEMENT";
export type EligibilityStatus = "ELIGIBLE" | "NOT_ELIGIBLE" | "UNKNOWN";
export type Domesticity = "DOMESTIC" | "INTERNATIONAL";
export type HotelStatus = "TRUE" | "FALSE" | "UNKNOWN";
export type TimelineActivityKind = "OPERATING" | "DEADHEAD" | "RESERVE" | "TRAINING" | "COURSE" | "EVALUATION" | "GROUND_ACTIVITY" | "STANDBY" | "DUTY_CONTINUITY" | "TRIP_CONTINUITY_AWAY_FROM_BASE" | "AT_COMPANY_DISPOSAL";

export type GroundPresence = { id: string; contextId: string; startAt: string; endAt: string; location: string | null; country: string | null; timezone: string | null };
export type DiemTimelineActivity = GroundPresence & { kind: TimelineActivityKind; rawReference?: string | null; internationalDiemRateGroup?: InternationalDiemRateGroup };
export type HotelInterval = { id: string; startAt: string; endAt: string; location: string; hotelUsed: HotelStatus; hotelWaived: HotelStatus };
export type TransportDuty = { id: string; presentationAt: string | null; releaseAt: string | null; startAirport: string | null; endAirport: string | null; startTimezone: string | null; endTimezone: string | null };
export type EntitlementInput = {
  importId: string;
  contractualBase: string | null;
  periodStart?: string | null;
  periodEnd?: string | null;
  activities?: DiemTimelineActivity[];
  presences?: GroundPresence[];
  duties: TransportDuty[];
  mealMainDiemCents: number | null;
  breakfastPercent: number | null;
  /** Legacy input retained for callers during the v2 transition; airport catalog is authoritative. */
  internationalMeal?: { currency: string; amountMinorUnits: number | null; parameterId: string | null } | null;
  madrugadaTransportCents: number | null;
  hotelWaivedLocations: ReadonlySet<string>;
  breakfastStillDueLocations: ReadonlySet<string>;
  hotelBreakfastIncludedLocations?: ReadonlySet<string>;
  hotelUsedByDefault?: boolean;
  hotelIntervals?: HotelInterval[];
};
export type FinancialEntitlement = { id: string; subjectType: "DUTY" | "TRIP"; subjectId: string; entitlementType: EntitlementType; entitlementDate: string; location: string | null; country: string | null; domesticity: Domesticity | null; currency: string | null; amountMinorUnits: number | null; quantity: number; startAt: string; endAt: string; eligibilityStatus: EligibilityStatus; reason: string | null; confidence: "HIGH" | "MEDIUM" | "LOW"; provenance: Record<string, unknown> };

const mealWindows = [{ key: "BREAKFAST", start: "05:00", end: "08:00" }, { key: "LUNCH", start: "11:00", end: "13:00" }, { key: "DINNER", start: "19:00", end: "20:00" }, { key: "SUPPER", start: "00:00", end: "01:00" }] as const;
type Meal = typeof mealWindows[number]["key"];
type Rate = { currency: string; amountMinorUnits: number; group: InternationalDiemRateGroup };
const internationalRates: Record<InternationalDiemRateGroup, Rate> = {
  SOUTH_AMERICA: { currency: "USD", amountMinorUnits: 2100, group: "SOUTH_AMERICA" }, PUJ: { currency: "USD", amountMinorUnits: 2500, group: "PUJ" }, CCS: { currency: "USD", amountMinorUnits: 2500, group: "CCS" }, CARIBBEAN_OTHER: { currency: "USD", amountMinorUnits: 2100, group: "CARIBBEAN_OTHER" }, NORTH_AMERICA: { currency: "USD", amountMinorUnits: 2500, group: "NORTH_AMERICA" }, MEXICO: { currency: "USD", amountMinorUnits: 2500, group: "MEXICO" }, EUROPE: { currency: "EUR", amountMinorUnits: 2300, group: "EUROPE" }, UNITED_KINGDOM: { currency: "GBP", amountMinorUnits: 2300, group: "UNITED_KINGDOM" }, OTHER_COUNTRIES: { currency: "USD", amountMinorUnits: 2100, group: "OTHER_COUNTRIES" },
};
const countryGroups: Record<string, InternationalDiemRateGroup> = { US: "NORTH_AMERICA", CA: "NORTH_AMERICA", MX: "MEXICO", GB: "UNITED_KINGDOM", DO: "CARIBBEAN_OTHER", VE: "SOUTH_AMERICA", AR: "SOUTH_AMERICA", CL: "SOUTH_AMERICA", CO: "SOUTH_AMERICA", PE: "SOUTH_AMERICA", UY: "SOUTH_AMERICA", PY: "SOUTH_AMERICA", BO: "SOUTH_AMERICA", EC: "SOUTH_AMERICA", FR: "EUROPE", DE: "EUROPE", ES: "EUROPE", IT: "EUROPE", PT: "EUROPE", NL: "EUROPE", BE: "EUROPE", CH: "EUROPE" };

function stableId(input: EntitlementInput, type: EntitlementType, date: string, location: string | null) { const hash = createHash("sha256").update(`${FLIGHT_FINANCIAL_ENTITLEMENTS_VERSION}:${input.importId}:${type}:daily:${date}:${location ?? "UNKNOWN"}`).digest("hex"); return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-${(Number.parseInt(hash.slice(16, 18), 16) & 0x3f | 0x80).toString(16)}${hash.slice(18, 20)}-${hash.slice(20, 32)}`; }
function localDate(value: string, timezone: string) { return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value)); }
function localMinute(value: string, timezone: string) { const parts = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(value)); return Number(parts.find(part => part.type === "hour")?.value) * 60 + Number(parts.find(part => part.type === "minute")?.value); }
function datesBetween(start: string, end: string) { const values: string[] = []; for (let date = start; date <= end; date = new Date(`${date}T12:00:00.000Z`).getTime() ? new Date(Date.parse(`${date}T12:00:00.000Z`) + 86400000).toISOString().slice(0, 10) : end) values.push(date); return values; }
function mealType(meal: Meal, domesticity: Domesticity): EntitlementType { return `${domesticity === "DOMESTIC" ? "DOMESTIC" : "INTERNATIONAL"}_${meal}` as EntitlementType; }
function intersects(startAt: string, endAt: string, from: string, to: string) { return Date.parse(startAt) < Date.parse(to) && Date.parse(endAt) > Date.parse(from); }
function overlapMinutes(left: DiemTimelineActivity, from: string, to: string) { return Math.max(0, Math.min(Date.parse(left.endAt), Date.parse(to)) - Math.max(Date.parse(left.startAt), Date.parse(from))) / 60000; }
function rateFor(meal: Meal, country: string, rateGroup: InternationalDiemRateGroup | undefined, input: EntitlementInput, domesticity: Domesticity) {
  if (domesticity === "DOMESTIC") return { currency: "BRL", amountMinorUnits: meal === "BREAKFAST" && input.mealMainDiemCents !== null && input.breakfastPercent !== null ? Math.round(input.mealMainDiemCents * input.breakfastPercent / 100) : meal === "BREAKFAST" ? null : input.mealMainDiemCents, group: null };
  const rate = internationalRates[rateGroup ?? countryGroups[country] ?? "OTHER_COUNTRIES"]; return { currency: rate.currency, amountMinorUnits: meal === "BREAKFAST" ? Math.round(rate.amountMinorUnits / 4) : rate.amountMinorUnits, group: rate.group };
}
function periodFor(input: EntitlementInput, activities: readonly DiemTimelineActivity[]) {
  if (input.periodStart && input.periodEnd) return { start: input.periodStart, end: input.periodEnd };
  const dates = activities.flatMap(activity => activity.timezone ? [localDate(activity.startAt, activity.timezone), localDate(activity.endAt, activity.timezone)] : []);
  return dates.length ? { start: dates.sort()[0], end: dates.sort().at(-1)! } : null;
}
function reasonFor(kind: TimelineActivityKind) { return kind === "TRAINING" || kind === "COURSE" || kind === "EVALUATION" || kind === "GROUND_ACTIVITY" ? "ELIGIBLE_TRAINING_OVERLAP" : kind === "DEADHEAD" ? "ELIGIBLE_DEADHEAD_OVERLAP" : kind === "RESERVE" ? "ELIGIBLE_RESERVE_OVERLAP" : kind === "STANDBY" ? "ELIGIBLE_STANDBY_OVERLAP" : kind === "TRIP_CONTINUITY_AWAY_FROM_BASE" ? "ELIGIBLE_TRIP_CONTINUITY_AWAY_FROM_BASE" : kind === "AT_COMPANY_DISPOSAL" ? "ELIGIBLE_COMPANY_DISPOSAL_OVERLAP" : "ELIGIBLE_SERVICE_OVERLAP"; }
function activityPriority(kind: TimelineActivityKind) { return kind === "DUTY_CONTINUITY" ? 0 : kind === "TRIP_CONTINUITY_AWAY_FROM_BASE" ? 1 : kind === "STANDBY" ? 2 : 3; }

export function deriveFinancialEntitlements(input: EntitlementInput): FinancialEntitlement[] {
  const activities: DiemTimelineActivity[] = input.activities ?? (input.presences ?? []).map(activity => ({ ...activity, kind: "DUTY_CONTINUITY" as const })); const period = periodFor(input, activities); const entitlements: FinancialEntitlement[] = [];
  if (period) for (const date of datesBetween(period.start, period.end)) for (const window of mealWindows) {
    const candidates = activities.filter(activity => activity.timezone && intersects(activity.startAt, activity.endAt, localAtUtc(date, window.start, activity.timezone), localAtUtc(date, window.end, activity.timezone))).sort((left, right) => activityPriority(right.kind) - activityPriority(left.kind) || overlapMinutes(right, localAtUtc(date, window.start, right.timezone!), localAtUtc(date, window.end, right.timezone!)) - overlapMinutes(left, localAtUtc(date, window.start, left.timezone!), localAtUtc(date, window.end, left.timezone!)) || left.startAt.localeCompare(right.startAt) || left.id.localeCompare(right.id));
    const activity = candidates[0] ?? null; const timezone = activity?.timezone ?? "America/Sao_Paulo"; const startAt = localAtUtc(date, window.start, timezone); const endAt = localAtUtc(date, window.end, timezone); const location = activity?.location ?? input.contractualBase; const country = activity?.country ?? (location === input.contractualBase ? "BR" : null); const domesticity: Domesticity | null = country === null ? null : country === "BR" ? "DOMESTIC" : "INTERNATIONAL"; const type = mealType(window.key, domesticity ?? "DOMESTIC");
    let eligibility: EligibilityStatus = "NOT_ELIGIBLE"; let reason = "NOT_ELIGIBLE_NO_SERVICE_IN_WINDOW"; let confidence: FinancialEntitlement["confidence"] = "HIGH";
    if (activity && (!activity.location || !activity.country || !activity.timezone)) { eligibility = "UNKNOWN"; reason = "UNKNOWN_LOCATION"; confidence = "LOW"; }
    else if (activity) { eligibility = "ELIGIBLE"; reason = reasonFor(activity.kind); }
    const hotelInterval = window.key === "BREAKFAST" && location ? (input.hotelIntervals ?? []).find(interval => interval.location === location && intersects(interval.startAt, interval.endAt, startAt, endAt)) ?? null : null;
    const hotelWaived: HotelStatus = hotelInterval?.hotelWaived ?? (location !== null && input.hotelWaivedLocations.has(location) ? "TRUE" : "UNKNOWN"); const hotelUsed: HotelStatus = hotelInterval?.hotelUsed ?? "FALSE"; const breakfastIncluded: HotelStatus = hotelInterval?.hotelUsed === "TRUE" ? "TRUE" : hotelInterval?.hotelWaived === "TRUE" && location !== null && input.breakfastStillDueLocations.has(location) ? "FALSE" : hotelInterval === null ? "FALSE" : "UNKNOWN";
    if (window.key === "BREAKFAST" && eligibility === "ELIGIBLE") { if (breakfastIncluded === "TRUE") { eligibility = "NOT_ELIGIBLE"; reason = "NOT_ELIGIBLE_HOTEL_BREAKFAST"; } else if (breakfastIncluded === "UNKNOWN") { eligibility = "UNKNOWN"; reason = "UNKNOWN_HOTEL_STATUS"; confidence = "LOW"; } }
    const amount = domesticity === null ? { currency: null, amountMinorUnits: null, group: null } : rateFor(window.key, country!, activity?.internationalDiemRateGroup, input, domesticity);
    if (eligibility === "ELIGIBLE" && amount.amountMinorUnits === null) { eligibility = "UNKNOWN"; reason = domesticity === "INTERNATIONAL" ? "UNKNOWN_INTERNATIONAL_RATE" : "MEAL_PARAMETER_NOT_CATALOGED"; confidence = "LOW"; }
    entitlements.push({ id: stableId(input, type, date, location), subjectType: "TRIP", subjectId: `daily:${date}:${window.key}`, entitlementType: type, entitlementDate: date, location, country, domesticity, currency: amount.currency, amountMinorUnits: amount.amountMinorUnits, quantity: 1, startAt, endAt, eligibilityStatus: eligibility, reason, confidence, provenance: { algorithm: "deriveDailyDiemTimeline", version: FLIGHT_FINANCIAL_ENTITLEMENTS_VERSION, mealWindow: window, timelineActivityId: activity?.id ?? null, timelineActivityKind: activity?.kind ?? "OFF", rawReference: activity?.rawReference ?? null, hotelIntervalId: hotelInterval?.id ?? null, hotelUsed, hotelWaived, hotelBreakfastIncluded: breakfastIncluded, internationalDiemRateGroup: amount.group, earlyCompletionProtection: "REVIEW_REQUIRED_IF_EXECUTION_ENDED_EARLY" } });
  }
  for (const duty of input.duties) { const boundaries = [{ at: duty.presentationAt, airport: duty.startAirport, timezone: duty.startTimezone, kind: "START" }, { at: duty.releaseAt, airport: duty.endAirport, timezone: duty.endTimezone, kind: "END" }].filter((value): value is { at: string; airport: string; timezone: string; kind: string } => Boolean(value.at && value.airport && value.timezone)); const qualifying = boundaries.filter(boundary => localMinute(boundary.at, boundary.timezone) < 360 && boundary.airport === input.contractualBase); if (!qualifying.length) continue; const first = qualifying[0]; const dual = qualifying.length > 1; const id = createHash("sha256").update(`${FLIGHT_FINANCIAL_ENTITLEMENTS_VERSION}:${input.importId}:transport:${duty.id}`).digest("hex"); entitlements.push({ id: `${id.slice(0, 8)}-${id.slice(8, 12)}-5${id.slice(13, 16)}-${(Number.parseInt(id.slice(16, 18), 16) & 0x3f | 0x80).toString(16)}${id.slice(18, 20)}-${id.slice(20, 32)}`, subjectType: "DUTY", subjectId: duty.id, entitlementType: "MADRUGADA_TRANSPORT_REIMBURSEMENT", entitlementDate: localDate(first.at, first.timezone), location: first.airport, country: "BR", domesticity: "DOMESTIC", currency: "BRL", amountMinorUnits: input.madrugadaTransportCents, quantity: 1, startAt: first.at, endAt: first.at, eligibilityStatus: dual || input.madrugadaTransportCents === null ? "UNKNOWN" : "ELIGIBLE", reason: dual ? "START_AND_END_QUALIFY_REQUIRES_POLICY" : input.madrugadaTransportCents === null ? "TRANSPORT_PARAMETER_NOT_CATALOGED" : null, confidence: dual || input.madrugadaTransportCents === null ? "LOW" : "HIGH", provenance: { algorithm: "deriveMadrugadaTransportEntitlement", version: FLIGHT_FINANCIAL_ENTITLEMENTS_VERSION, actClause: "5.9", qualifyingBoundary: first.kind } }); }
  return entitlements.sort((left, right) => left.startAt.localeCompare(right.startAt) || left.id.localeCompare(right.id));
}

export function summarizeFinancialEntitlements(items: readonly FinancialEntitlement[]) { const currencies: Record<string, { knownMinorUnits: number; unknownAmountCount: number; byType: Record<string, number> }> = {}; for (const item of items.filter(item => item.eligibilityStatus === "ELIGIBLE")) { const currency = item.currency ?? "UNKNOWN"; const target = currencies[currency] ??= { knownMinorUnits: 0, unknownAmountCount: 0, byType: {} }; target.byType[item.entitlementType] = (target.byType[item.entitlementType] ?? 0) + 1; if (item.amountMinorUnits === null) target.unknownAmountCount += 1; else target.knownMinorUnits += item.amountMinorUnits * item.quantity; } return currencies; }
