import { createClient } from "@supabase/supabase-js";
import { deriveFinancialUnits, FLIGHT_FINANCIAL_UNITS_VERSION } from "./financial-units";

export async function buildFlightFinancialUnits(importId: string, ownerUserId?: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL; const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("As credenciais de servidor do Supabase não foram configuradas.");
  const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const imported = await supabase.from("flight_schedule_imports").select("id,user_id,document_period_start").eq("id", importId).maybeSingle();
  if (imported.error || !imported.data || (ownerUserId && imported.data.user_id !== ownerUserId)) throw new Error("Importação de escala não encontrada.");
  const [legs, facts, profiles] = await Promise.all([
    supabase.from("flight_legs").select("id,leg_type,calculated_duration_minutes").eq("import_id", importId),
    supabase.from("flight_fact_records").select("subject_id,fact_key,value").eq("import_id", importId).in("fact_key", ["standby", "reserve"]),
    supabase.from("flight_compensation_profiles").select("id,effective_from,effective_to").eq("user_id", imported.data.user_id).order("effective_from", { ascending: false }),
  ]);
  if (legs.error || facts.error || profiles.error) throw new Error(legs.error?.message ?? facts.error?.message ?? profiles.error?.message ?? "Não foi possível carregar os fatos financeiros.");
  const period = imported.data.document_period_start ?? "";
  const profile = (profiles.data ?? []).filter((item) => item.effective_from <= period && (item.effective_to === null || item.effective_to >= period))[0] ?? null;
  const policies = profile ? await supabase.from("flight_compensation_profile_policies").select("value").eq("profile_id", profile.id).eq("policy_key", "DEADHEAD_REMUNERATION_POLICY").maybeSingle() : { data: null, error: null };
  if (policies.error) throw new Error(policies.error.message);
  const units = deriveFinancialUnits({ importId, legs: (legs.data ?? []).map((leg) => ({ id: leg.id, legType: leg.leg_type as "OPERATING" | "DEADHEAD", durationMinutes: leg.calculated_duration_minutes })), standby: (facts.data ?? []).filter((fact) => fact.fact_key === "standby").map((fact) => ({ id: String(fact.subject_id), durationMinutes: typeof (fact.value as { durationMinutes?: unknown }).durationMinutes === "number" ? (fact.value as { durationMinutes: number }).durationMinutes : null })), reserve: (facts.data ?? []).filter((fact) => fact.fact_key === "reserve").map((fact) => ({ id: String(fact.subject_id), durationMinutes: typeof (fact.value as { durationMinutes?: unknown }).durationMinutes === "number" ? (fact.value as { durationMinutes: number }).durationMinutes : null })), deadheadPolicy: policies.data?.value === "SAME_AS_OPERATING_FOR_REMUNERATION" ? "SAME_AS_OPERATING_FOR_REMUNERATION" : "UNKNOWN" });
  const removed = await supabase.from("flight_financial_facts").delete().eq("import_id", importId); if (removed.error) throw new Error(removed.error.message);
  const inserted = await supabase.from("flight_financial_facts").insert(units.map((item) => ({ id: item.id, import_id: importId, subject_type: item.subjectType, subject_id: item.subjectId, financial_fact_type: item.financialFactType, actual_seconds: item.actualSeconds, remunerable_seconds: item.remunerableSeconds, guarantee_numerator_seconds: item.guaranteeNumeratorSeconds, guarantee_denominator: item.guaranteeDenominator, normal_operating_candidate_seconds: item.normalOperatingCandidateSeconds, deadhead_candidate_seconds: item.deadheadCandidateSeconds, standby_equivalent_numerator_seconds: item.standbyEquivalentNumeratorSeconds, standby_equivalent_denominator: item.standbyEquivalentDenominator, reserve_candidate_seconds: item.reserveCandidateSeconds, special_time_pending_seconds: item.specialTimePendingSeconds, source_type: "CALCULATED", confidence: item.confidence, lifecycle: "REVIEWED", engine_version: FLIGHT_FINANCIAL_UNITS_VERSION, provenance: item.provenance, attributes: item.attributes })));
  if (inserted.error) throw new Error(inserted.error.message);
  const accumulator = units.find((item) => item.financialFactType === "PRELIMINARY_GUARANTEE_ACCUMULATOR")!;
  return { importId, engineVersion: FLIGHT_FINANCIAL_UNITS_VERSION, unitCount: units.length, operatingSeconds: accumulator.normalOperatingCandidateSeconds, deadheadSeconds: accumulator.deadheadCandidateSeconds, standbyEquivalent: { numeratorSeconds: accumulator.standbyEquivalentNumeratorSeconds, denominator: accumulator.standbyEquivalentDenominator }, reserveSeconds: accumulator.reserveCandidateSeconds, specialTimePendingSeconds: accumulator.specialTimePendingSeconds };
}
