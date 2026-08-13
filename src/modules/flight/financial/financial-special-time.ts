import { createHash } from "node:crypto";

export const FLIGHT_FINANCIAL_SPECIAL_TIME_VERSION = "flight-financial-special-time/1.0.0";
export type SegmentActivity = "OPERATING" | "DEADHEAD" | "STANDBY" | "RESERVE";
export type HolidayStatus = "TRUE" | "FALSE" | "UNKNOWN";
export type FinancialSegment = { id: string; subjectId: string; activityType: SegmentActivity; startAt: string; endAt: string; durationSeconds: number; isNight: boolean; isSunday: boolean; holidayStatus: HolidayStatus; holidayName: string | null; holidayScope: string | null; normalEquivalentSeconds: number; nightEquivalentNumeratorSeconds: number; nightEquivalentDenominator: number; referenceTimezone: "UTC"; provenance: { algorithm: string; version: string } };
export type SegmentInput = { importId: string; subjectId: string; activityType: SegmentActivity; startAt: string; endAt: string; holidays: Array<{ date: string; name: string; scope: string }> ; calendarComplete: boolean };

export function holidayAppliesToBase(holiday: { scope: string; baseCode: string | null }, contractualBase: string | null) { return holiday.scope === "NATIONAL" || (contractualBase !== null && holiday.baseCode === contractualBase); }

function id(input: SegmentInput, startAt: string, endAt: string) { const hash = createHash("sha256").update(`${FLIGHT_FINANCIAL_SPECIAL_TIME_VERSION}:${input.importId}:${input.subjectId}:${startAt}:${endAt}`).digest("hex"); return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-${(Number.parseInt(hash.slice(16, 18), 16) & 0x3f | 0x80).toString(16)}${hash.slice(18, 20)}-${hash.slice(20, 32)}`; }
function date(at: number) { return new Date(at).toISOString().slice(0, 10); }
function night(at: number) { const hour = new Date(at).getUTCHours(); return hour >= 21 || hour < 9; }
function boundaries(start: number, end: number) { const values = new Set<number>([start, end]); const cursor = new Date(start); cursor.setUTCHours(0, 0, 0, 0); while (cursor.getTime() <= end) { for (const hour of [0, 9, 21]) { const point = Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth(), cursor.getUTCDate(), hour); if (point > start && point < end) values.add(point); } cursor.setUTCDate(cursor.getUTCDate() + 1); } return [...values].sort((a, b) => a - b); }

export function segmentFinancialInterval(input: SegmentInput): FinancialSegment[] {
  const start = Date.parse(input.startAt); const end = Date.parse(input.endAt); if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return [];
  const segments: FinancialSegment[] = [];
  const points = boundaries(start, end);
  for (let index = 1; index < points.length; index += 1) {
    const from = points[index - 1]; const to = points[index]; if (to <= from) continue;
    const day = date(from); const matched = input.holidays.filter(holiday => holiday.date === day); const holidayStatus: HolidayStatus = matched.length ? "TRUE" : input.calendarComplete ? "FALSE" : "UNKNOWN";
    const isNight = night(from); const durationSeconds = (to - from) / 1000;
    segments.push({ id: id(input, new Date(from).toISOString(), new Date(to).toISOString()), subjectId: input.subjectId, activityType: input.activityType, startAt: new Date(from).toISOString(), endAt: new Date(to).toISOString(), durationSeconds, isNight, isSunday: new Date(from).getUTCDay() === 0, holidayStatus, holidayName: matched[0]?.name ?? null, holidayScope: matched[0]?.scope ?? null, normalEquivalentSeconds: isNight ? 0 : durationSeconds, nightEquivalentNumeratorSeconds: isNight ? durationSeconds * 8 : 0, nightEquivalentDenominator: isNight ? 7 : 1, referenceTimezone: "UTC", provenance: { algorithm: "segmentFinancialIntervalUtc", version: FLIGHT_FINANCIAL_SPECIAL_TIME_VERSION } });
  }
  return segments;
}

export function segmentGroundFinancialInterval(input: SegmentInput & { timezone: string; equivalenceDenominator: 1 | 3 }): FinancialSegment[] {
  const start = Date.parse(input.startAt); const end = Date.parse(input.endAt); if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return [];
  const points = new Set<number>([start, end]);
  for (let instant = start; instant <= end; instant += 60000) { const parts = new Intl.DateTimeFormat("en-CA", { timeZone: input.timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(instant)); const hour = Number(parts.find(part => part.type === "hour")?.value); const minute = Number(parts.find(part => part.type === "minute")?.value); const boundaries = input.activityType === "RESERVE" ? [0, 5, 22] : [0, 9, 21]; if (minute === 0 && boundaries.includes(hour)) points.add(instant); }
  const sorted = [...points].sort((left, right) => left - right); const result: FinancialSegment[] = [];
  for (let index = 1; index < sorted.length; index += 1) { const from = sorted[index - 1]; const to = sorted[index]; const local = new Intl.DateTimeFormat("en-CA", { timeZone: input.timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23", weekday: "short" }).formatToParts(new Date(from)); const hour = Number(local.find(part => part.type === "hour")?.value); const date = `${local.find(part => part.type === "year")?.value}-${local.find(part => part.type === "month")?.value}-${local.find(part => part.type === "day")?.value}`; const isSunday = local.find(part => part.type === "weekday")?.value === "Sun"; const holidays = input.holidays.filter(holiday => holiday.date === date); const isNight = input.activityType === "RESERVE" ? hour >= 22 || hour < 5 : hour >= 21 || hour < 9; const durationSeconds = (to - from) / 1000;
    result.push({ id: id(input, new Date(from).toISOString(), new Date(to).toISOString()), subjectId: input.subjectId, activityType: input.activityType, startAt: new Date(from).toISOString(), endAt: new Date(to).toISOString(), durationSeconds, isNight, isSunday, holidayStatus: holidays.length ? "TRUE" : input.calendarComplete ? "FALSE" : "UNKNOWN", holidayName: holidays[0]?.name ?? null, holidayScope: holidays[0]?.scope ?? null, normalEquivalentSeconds: isNight ? 0 : durationSeconds, nightEquivalentNumeratorSeconds: isNight ? durationSeconds : 0, nightEquivalentDenominator: input.equivalenceDenominator, referenceTimezone: "UTC", provenance: { algorithm: input.activityType === "RESERVE" ? "segmentReserveLocalGroundInterval" : "segmentStandbyLocalInterval", version: FLIGHT_FINANCIAL_SPECIAL_TIME_VERSION } }); }
  return result;
}

export function summarizeSpecialTime(segments: readonly FinancialSegment[]) { return segments.reduce((summary, segment) => { summary.actualSeconds += segment.durationSeconds; if (segment.isNight) { summary.nightActualSeconds += segment.durationSeconds; summary.nightEquivalentNumeratorSeconds += segment.nightEquivalentNumeratorSeconds; } if (segment.isSunday) summary.sundaySeconds += segment.durationSeconds; if (segment.holidayStatus === "TRUE") summary.holidaySeconds += segment.durationSeconds; if (segment.isNight && segment.isSunday) summary.nightSundaySeconds += segment.durationSeconds; if (segment.isNight && segment.holidayStatus === "TRUE") summary.nightHolidaySeconds += segment.durationSeconds; if (!segment.isNight && !segment.isSunday && segment.holidayStatus === "FALSE") summary.normalGuaranteeEligibleSeconds += segment.durationSeconds; return summary; }, { actualSeconds: 0, normalGuaranteeEligibleSeconds: 0, nightActualSeconds: 0, nightEquivalentNumeratorSeconds: 0, nightEquivalentDenominator: 7, sundaySeconds: 0, holidaySeconds: 0, nightSundaySeconds: 0, nightHolidaySeconds: 0 }); }
