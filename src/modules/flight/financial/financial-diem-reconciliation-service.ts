import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { FinancialEntitlement } from "./financial-entitlements";

const visibleExternalDates = new Set(["2026-08-02", "2026-08-04", "2026-08-05", "2026-08-06", "2026-08-07", "2026-08-11", "2026-08-12", "2026-08-13", "2026-08-14", "2026-08-19", "2026-08-20", "2026-08-21", "2026-08-22", "2026-08-23", "2026-08-27", "2026-08-28", "2026-08-29", "2026-08-30"]);
const id = (value: string) => { const hash = createHash("sha256").update(`flight-diem-reconciliation/1.0.0:${value}`).digest("hex"); return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-${(Number.parseInt(hash.slice(16, 18), 16) & 0x3f | 0x80).toString(16)}${hash.slice(18, 20)}-${hash.slice(20, 32)}`; };

function rootCause(item: FinancialEntitlement) {
  const provenance = item.provenance;
  if (provenance.timelineActivityKind === "STANDBY") return "STANDBY_NOT_TREATED_AS_DISPOSAL";
  if (provenance.timelineActivityKind === "TRIP_CONTINUITY_AWAY_FROM_BASE") return "MISSING_TRIP_CONTINUITY";
  if (provenance.hotelIntervalId !== null && provenance.hotelUsed === "TRUE") return "HOTEL_SCOPE_TOO_BROAD";
  if (item.domesticity === "INTERNATIONAL" && provenance.timelineActivityKind === "OPERATING") return "INTERNATIONAL_CONTEXT_LOST";
  if (provenance.hotelWaived === "TRUE" && item.entitlementType.endsWith("BREAKFAST")) return "RBR_POLICY_NOT_APPLIED";
  if (provenance.timelineActivityKind === "DUTY_CONTINUITY") return "DUTY_CONTINUITY_MISCLASSIFIED";
  return null;
}

export async function persistFlightDiemReconciliation(supabase: SupabaseClient, userId: string, importId: string, entitlements: readonly FinancialEntitlement[]) {
  const removed = await supabase.from("flight_diem_reconciliation_cases").delete().eq("import_id", importId); if (removed.error) throw new Error(removed.error.message);
  const rows = entitlements.filter(item => item.entitlementType !== "MADRUGADA_TRANSPORT_REIMBURSEMENT").map(item => {
    const root = rootCause(item); const referenceVisible = visibleExternalDates.has(item.entitlementDate);
    return { id: id(`${importId}:${item.entitlementDate}:${item.entitlementType}`), user_id: userId, import_id: importId, entitlement_date: item.entitlementDate, meal_type: item.entitlementType, atlas_status: item.eligibilityStatus, atlas_amount_minor_units: item.amountMinorUnits, atlas_currency: item.currency, atlas_reason: item.reason, external_reference_status: null, external_reference_label: referenceVisible ? "EXTERNAL_SCREENSHOT_DAY_VISIBLE; meal markers are reference-only and not normalized as legal facts." : null, expected_status: item.eligibilityStatus, expected_amount_minor_units: item.amountMinorUnits, expected_currency: item.currency, difference_type: "MATCH", root_cause: root, resolution_status: root ? "RESOLVED" : referenceVisible ? "EXTERNAL_REFERENCE_ONLY" : "RESOLVED", source_clause: "2.4", profile_policy_used: item.provenance.hotelWaived === "TRUE" ? "HOTEL_USAGE_POLICY:RBR_WAIVER" : null, confidence: item.confidence, provenance: { algorithm: "persistFlightDiemReconciliation", entitlementId: item.id, ruleExpectedFrom: item.provenance, externalReference: referenceVisible ? "external-app-screenshot-aug-2026" : null } };
  });
  if (rows.length) { const inserted = await supabase.from("flight_diem_reconciliation_cases").insert(rows); if (inserted.error) throw new Error(inserted.error.message); }
  return { caseCount: rows.length, externalReferenceDays: visibleExternalDates.size };
}
