import { createClient } from "@supabase/supabase-js";
import { buildFinancialGuarantees, FLIGHT_FINANCIAL_GUARANTEE_VERSION, type FinancialComponent, type GuaranteeComponentInput, type Truth } from "./financial-guarantee";

const ACT_INSTRUMENT_ID = "a49d8597-8372-4682-9e3b-4f97d4b21944";
const truth = (value: unknown): Truth => value === true || value === "TRUE" ? "TRUE" : value === false || value === "FALSE" ? "FALSE" : "UNKNOWN";
function voluntaryFromFacts(rows: Array<{ value: unknown }>) { const values = rows.flatMap(row => { const value = row.value as Record<string, unknown>; return [value.voluntary, value.changeVoluntary].filter(item => item !== undefined).map(truth); }); return values.length > 0 && values.every(value => value === "TRUE") ? "TRUE" : values.length > 0 && values.every(value => value === "FALSE") ? "FALSE" : "UNKNOWN" as Truth; }
export function specialQuantity(rows: Array<{ activity_type: string; duration_seconds: number; is_night: boolean; is_sunday: boolean; holiday_status: string; normal_equivalent_seconds: number; night_equivalent_numerator_seconds: number }>, component: FinancialComponent) { const operating = rows.filter(row => row.activity_type === "OPERATING"); if (component === "NORMAL_OPERATING") return operating.filter(row => !row.is_night && !row.is_sunday && row.holiday_status === "FALSE").reduce((sum, row) => sum + row.normal_equivalent_seconds, 0); if (component === "NIGHT") return operating.reduce((sum, row) => sum + row.night_equivalent_numerator_seconds, 0); if (component === "SUNDAY") return operating.filter(row => row.is_sunday).reduce((sum, row) => sum + row.duration_seconds, 0); return operating.filter(row => row.holiday_status === "TRUE").reduce((sum, row) => sum + row.duration_seconds, 0); }

export async function buildFlightFinancialGuarantees(executedImportId: string, ownerUserId?: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL; const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("As credenciais de servidor do Supabase não foram configuradas.");
  const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const executedResult = await supabase.from("flight_schedule_imports").select("id,user_id,schedule_month_id,document_period_start,schedule_role").eq("id", executedImportId).maybeSingle();
  if (executedResult.error || !executedResult.data || (ownerUserId && executedResult.data.user_id !== ownerUserId)) throw new Error("Importação executada não encontrada.");
  const executed = executedResult.data;
  if (executed.schedule_role === "PLANNED") throw new Error("A decisão financeira requer uma importação executada.");
  const plannedResult = await supabase.from("flight_schedule_imports").select("id").eq("schedule_month_id", executed.schedule_month_id).eq("schedule_role", "PLANNED").maybeSingle();
  if (plannedResult.error || !plannedResult.data) throw new Error("Planejada correspondente não encontrada.");
  const plannedId = plannedResult.data.id;
  const [units, segments, entitlements, facts] = await Promise.all([
    supabase.from("flight_financial_facts").select("import_id,normal_operating_candidate_seconds,deadhead_candidate_seconds,standby_equivalent_numerator_seconds,standby_equivalent_denominator,reserve_candidate_seconds").in("import_id", [plannedId, executed.id]).eq("financial_fact_type", "PRELIMINARY_GUARANTEE_ACCUMULATOR"),
    supabase.from("flight_financial_segments").select("import_id,activity_type,duration_seconds,is_night,is_sunday,holiday_status,normal_equivalent_seconds,night_equivalent_numerator_seconds").in("import_id", [plannedId, executed.id]),
    supabase.from("flight_financial_entitlements").select("import_id,eligibility_status").in("import_id", [plannedId, executed.id]),
    supabase.from("flight_fact_records").select("fact_key,value").eq("import_id", executed.id).in("fact_key", ["schedule_change", "off_substitution"]),
  ]);
  if (units.error || segments.error || entitlements.error || facts.error) throw new Error(units.error?.message ?? segments.error?.message ?? entitlements.error?.message ?? facts.error?.message ?? "Não foi possível carregar a garantia financeira.");
  const accumulator = (id: string) => (units.data ?? []).find(item => item.import_id === id);
  const plannedUnits = accumulator(plannedId); const executedUnits = accumulator(executed.id);
  if (!plannedUnits || !executedUnits) throw new Error("Acumuladores financeiros não encontrados.");
  const plannedSegments = (segments.data ?? []).filter(item => item.import_id === plannedId); const executedSegments = (segments.data ?? []).filter(item => item.import_id === executed.id);
  const plannedEntitlements = (entitlements.data ?? []).filter(item => item.import_id === plannedId && item.eligibility_status === "ELIGIBLE").length;
  const executedEntitlements = (entitlements.data ?? []).filter(item => item.import_id === executed.id && item.eligibility_status === "ELIGIBLE").length;
  const changeFacts = (facts.data ?? []).filter(item => item.fact_key === "schedule_change"); const substitutionFacts = (facts.data ?? []).filter(item => item.fact_key === "off_substitution");
  const voluntary = voluntaryFromFacts([...changeFacts, ...substitutionFacts]); const additive = substitutionFacts.some(row => { const value = row.value as Record<string, unknown>; return truth(value.changeVoluntary) === "TRUE" && truth(value.offWasSurrenderedForProgram) === "TRUE"; });
  const common = { voluntary, origin: voluntary === "UNKNOWN" ? "UNKNOWN" : "DOCUMENTED", voluntaryAdditive: additive };
  const input = (component: FinancialComponent, plannedQuantity: number, executedQuantity: number, unit: string, guaranteeApplicable: Truth): GuaranteeComponentInput => ({ component, plannedQuantity, executedQuantity, unit, guaranteeApplicable, ...common });
  const values: GuaranteeComponentInput[] = [
    input("NORMAL_OPERATING", specialQuantity(plannedSegments, "NORMAL_OPERATING"), specialQuantity(executedSegments, "NORMAL_OPERATING"), "SECONDS", "TRUE"),
    input("DEADHEAD", plannedUnits.deadhead_candidate_seconds, executedUnits.deadhead_candidate_seconds, "SECONDS", "TRUE"),
    input("STANDBY_EQUIVALENT", plannedUnits.standby_equivalent_numerator_seconds, executedUnits.standby_equivalent_numerator_seconds, "SECONDS_NUMERATOR_OVER_3", "TRUE"),
    input("RESERVE", plannedUnits.reserve_candidate_seconds, executedUnits.reserve_candidate_seconds, "SECONDS", "TRUE"),
    input("NIGHT", specialQuantity(plannedSegments, "NIGHT"), specialQuantity(executedSegments, "NIGHT"), "SECONDS_NUMERATOR_OVER_7", "UNKNOWN"),
    input("SUNDAY", specialQuantity(plannedSegments, "SUNDAY"), specialQuantity(executedSegments, "SUNDAY"), "SECONDS", "UNKNOWN"),
    input("HOLIDAY", specialQuantity(plannedSegments, "HOLIDAY"), specialQuantity(executedSegments, "HOLIDAY"), "SECONDS", "UNKNOWN"),
    input("MEAL_ENTITLEMENTS", plannedEntitlements, executedEntitlements, "ENTITLEMENT_COUNT", "UNKNOWN"),
    input("TRANSPORT_ENTITLEMENTS", 0, 0, "ENTITLEMENT_COUNT", "FALSE"),
  ];
  const decisions = buildFinancialGuarantees(plannedId, executed.id, values);
  const removed = await supabase.from("flight_financial_guarantee_decisions").delete().eq("executed_import_id", executed.id); if (removed.error) throw new Error(removed.error.message);
  const inserted = await supabase.from("flight_financial_guarantee_decisions").insert(decisions.map(item => ({ id: item.id, user_id: executed.user_id, month_date: executed.document_period_start, planned_import_id: plannedId, executed_import_id: executed.id, subject_type: "IMPORT", planned_subject_id: plannedId, executed_subject_id: executed.id, financial_component: item.component, quantity_unit: item.unit, planned_quantity: item.plannedQuantity, executed_quantity: item.executedQuantity, decision: item.decision, guarantee_applicable: item.guaranteeApplicable, voluntary_status: item.voluntary, change_origin: item.origin, reason: item.reason, source_instrument_id: ACT_INSTRUMENT_ID, source_clause: item.component === "MEAL_ENTITLEMENTS" || item.component === "TRANSPORT_ENTITLEMENTS" ? null : item.voluntary === "TRUE" ? "7.4" : "4.5", confidence: item.confidence, engine_version: FLIGHT_FINANCIAL_GUARANTEE_VERSION, provenance: { ...item.provenance, scheduleChangeCount: changeFacts.length, offSubstitutionCount: substitutionFacts.length, voluntaryAdditive: additive } }))); if (inserted.error) throw new Error(inserted.error.message);
  return { plannedImportId: plannedId, executedImportId: executed.id, decisionCount: decisions.length, decisions };
}
