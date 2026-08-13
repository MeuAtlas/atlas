import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { diemCycleStatus, halfMonthFor, paymentDateForEntitlement } from "./financial-diem-payment";
import { buildPayrollBuckets, payrollDecimalReference, type SourceActivity } from "./financial-payroll";

const id = (value: string) => { const hash = createHash("sha256").update(`flight-payroll/1.0.0:${value}`).digest("hex"); return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-${(Number.parseInt(hash.slice(16, 18), 16) & 0x3f | 0x80).toString(16)}${hash.slice(18, 20)}-${hash.slice(20, 32)}`; };

export type DiemCycleSource = { entitlement_date: string; eligibility_status: string; amount_minor_units: number | null; currency: string | null };
export function deriveFlightDiemPaymentCycles(importId: string, userId: string, entitlements: readonly DiemCycleSource[]) {
  const cycles = new Map<string, { paymentDate: string; halfMonth: "FIRST_HALF" | "SECOND_HALF"; currency: string | null; amount: number; items: Array<{ eligibilityStatus: string; amountMinorUnits: number | null }> }>();
  for (const item of entitlements.filter(item => item.eligibility_status !== "NOT_ELIGIBLE")) { const paymentDate = paymentDateForEntitlement(item.entitlement_date); const halfMonth = halfMonthFor(item.entitlement_date); const keyPart = `${paymentDate}:${item.currency ?? "UNKNOWN"}`; const cycle = cycles.get(keyPart) ?? { paymentDate, halfMonth, currency: item.currency, amount: 0, items: [] as Array<{ eligibilityStatus: string; amountMinorUnits: number | null }> }; if (item.eligibility_status === "ELIGIBLE") cycle.amount += item.amount_minor_units ?? 0; cycle.items.push({ eligibilityStatus: item.eligibility_status, amountMinorUnits: item.amount_minor_units }); cycles.set(keyPart, cycle); }
  return [...cycles.values()].map(cycle => ({ id: id(`${importId}:diem:${cycle.paymentDate}:${cycle.currency ?? "UNKNOWN"}`), user_id: userId, import_id: importId, payment_date: cycle.paymentDate, half_month: cycle.halfMonth, currency: cycle.currency, known_minor_units: cycle.amount, entitlement_count: cycle.items.length, status: diemCycleStatus(cycle.items), provenance: { engine: "flight-diem-payment/1.0.0" } }));
}

export async function buildFlightPayroll(importId: string, ownerUserId?: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL; const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Credenciais de servidor indisponíveis.");
  const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const source = await supabase.from("flight_schedule_imports").select("id,user_id").eq("id", importId).maybeSingle();
  if (source.error || !source.data || (ownerUserId && source.data.user_id !== ownerUserId)) throw new Error("Importação não encontrada.");
  const imported = source.data;
  const [segmentsResult, entitlementsResult] = await Promise.all([
    supabase.from("flight_financial_segments").select("activity_type,duration_seconds,is_night,is_sunday,holiday_status,night_equivalent_numerator_seconds,night_equivalent_denominator").eq("import_id", importId),
    supabase.from("flight_financial_entitlements").select("entitlement_date,eligibility_status,amount_minor_units,currency").eq("import_id", importId),
  ]);
  if (segmentsResult.error || entitlementsResult.error) throw new Error(segmentsResult.error?.message ?? entitlementsResult.error?.message ?? "Dados financeiros indisponíveis.");
  const segments = (segmentsResult.data ?? []).map(segment => ({ sourceActivity: segment.activity_type as SourceActivity, durationSeconds: segment.duration_seconds, isNight: segment.is_night, isSunday: segment.is_sunday, isHoliday: segment.holiday_status === "TRUE", nightEquivalentNumeratorSeconds: segment.night_equivalent_numerator_seconds, nightEquivalentDenominator: segment.night_equivalent_denominator, equivalenceNumeratorSeconds: segment.activity_type === "STANDBY" ? segment.duration_seconds : undefined, equivalenceDenominator: segment.activity_type === "STANDBY" ? 3 : undefined }));
  const buckets = buildPayrollBuckets(segments);
  const removedBuckets = await supabase.from("flight_payroll_bucket_runs").delete().eq("import_id", importId); if (removedBuckets.error) throw new Error(removedBuckets.error.message);
  const bucketRows = Object.entries(buckets).flatMap(([bucket, value]) => Object.entries(value.sourceSeconds).filter(([, seconds]) => seconds > 0).map(([activity, seconds]) => { const denominator = activity === "STANDBY" ? 3 : bucket === "NIGHT_NORMAL" || bucket === "SUNDAY_HOLIDAY_NIGHT" ? 7 : 1; const numerator = activity === "STANDBY" ? seconds : denominator === 7 ? seconds * 8 : seconds; return { id: id(`${importId}:${bucket}:${activity}`), user_id: imported.user_id, import_id: importId, bucket, source_activity: activity, actual_seconds: seconds, equivalent_numerator_seconds: numerator, equivalent_denominator: denominator, payroll_reference: payrollDecimalReference(numerator / denominator), provenance: { engine: "flight-payroll/1.0.0", sourceActivity: activity } }; }));
  if (bucketRows.length) { const inserted = await supabase.from("flight_payroll_bucket_runs").insert(bucketRows); if (inserted.error) throw new Error(inserted.error.message); }
  const cycleRows = deriveFlightDiemPaymentCycles(importId, imported.user_id, entitlementsResult.data ?? []);
  const removedCycles = await supabase.from("flight_diem_payment_cycles").delete().eq("import_id", importId); if (removedCycles.error) throw new Error(removedCycles.error.message);
  if (cycleRows.length) { const inserted = await supabase.from("flight_diem_payment_cycles").insert(cycleRows); if (inserted.error) throw new Error(inserted.error.message); }
  return { importId, buckets, diemCycles: cycleRows };
}
