import { extractPdfText } from "@/modules/finance/invoice-import/extract-pdf";
import { parseNetlineDocument, reconstructSpatialLines, NETLINE_PARSER_VERSION } from "./netline-parser";
import { parseFlightActivities, parseFlightLegends } from "./activity-parser";
import { parseFlightStructure } from "./flight-structure-parser";
import { calculateStructure, parseFooter, parseSpatialDocumentaryMetrics, parseSpatialDutyMetrics, parseTimeMetrics } from "./time-metrics";
import { reconcileFlightTime, type FlightTimeReconciliation } from "./processing-reconciliation";

type AwaitableResult = PromiseLike<{ error: { message: string } | null }>;
export type FlightScheduleProcessingClient = {
  rpc: (name: string, args: Record<string, unknown>) => AwaitableResult;
  from: (table: "flight_schedule_imports") => {
    select: (columns: string) => { eq: (column: string, value: string) => { single: () => PromiseLike<{ data: { id: string; storage_bucket: string; storage_path: string; schedule_month_id: string } | null; error: { message: string } | null }> } };
  };
  storage: { from: (bucket: string) => { download: (path: string) => PromiseLike<{ data: Blob | null; error: { message: string } | null }> } };
};

function warningJson(warnings: ReturnType<typeof parseNetlineDocument>["warnings"]) { return warnings.map(warning => ({ code: warning.code, severity: warning.severity, message: warning.message })); }

export type FlightScheduleProcessingOutcome = { status: "processed" | "incomplete"; reconciliation: FlightTimeReconciliation };

export async function processFlightScheduleImport(supabase: FlightScheduleProcessingClient, importId: string): Promise<FlightScheduleProcessingOutcome> {
  if (process.env.NEXT_RUNTIME) await import("server-only");
  const started = await supabase.rpc("begin_flight_schedule_processing", { p_import_id: importId });
  if (started.error) throw new Error(started.error.message);
  let parserResultPersisted = false;
  try {
    const imported = await supabase.from("flight_schedule_imports").select("id,storage_bucket,storage_path,schedule_month_id").eq("id", importId).single();
    if (imported.error || !imported.data) throw new Error("Importação de escala não encontrada.");
    const downloaded = await supabase.storage.from(imported.data.storage_bucket).download(imported.data.storage_path);
    if (downloaded.error || !downloaded.data) throw new Error("Arquivo original indisponível. Envie novamente a escala para continuar.");
    const extracted = await extractPdfText(downloaded.data);
    const parsed = parseNetlineDocument(extracted);
    const status = parsed.documentType && !parsed.warnings.some(item => item.severity === "warning" || item.severity === "error") ? "PROCESSED" : "PROCESSED_WITH_WARNINGS";
    const persisted = await supabase.rpc("persist_flight_schedule_parser_result", {
      p_import_id: importId, p_parser_version: NETLINE_PARSER_VERSION, p_status: status,
      p_document_type: parsed.documentType, p_document_confidence: parsed.confidence,
      p_crew_id: parsed.crewId, p_crew_name: parsed.crewName, p_home_base: parsed.homeBase,
      p_period_start: parsed.periodStart, p_period_end: parsed.periodEnd, p_generated_at: parsed.generatedAt,
      p_raw_text: extracted.pages.map(page => reconstructSpatialLines(page.items).map(line => line.text).join("\n")).join("\n\n"), p_warnings: warningJson(parsed.warnings), p_error_code: null, p_error_message: null,
      p_pages: extracted.pages.map(page => ({ page_number: page.pageNumber, raw_text: reconstructSpatialLines(page.items).map(line => line.text).join("\n") })),
      p_days: parsed.days.map(day => ({ schedule_date: day.scheduleDate, day_number: day.dayNumber, weekday: day.weekday, raw_text: day.rawText })),
      p_unknown: parsed.unknown.map(item => ({ page_number: item.pageNumber, raw_value: item.rawValue, raw_line: item.rawLine, parser_stage: item.parserStage, reason: item.reason })),
    });
    if (persisted.error) throw new Error(persisted.error.message);
    parserResultPersisted = true;
    const legends = parseFlightLegends(extracted.pages.map(page => reconstructSpatialLines(page.items).map(line => line.text).join("\n")).join("\n"));
    const activities = parseFlightActivities(parsed.days, legends);
    const activitiesPersisted = await supabase.rpc("persist_flight_schedule_activities", {
      p_import_id: importId,
      p_events: activities.map(event => ({ schedule_date:event.scheduleDate,event_type:event.eventType,event_code:event.eventCode,event_label:event.eventLabel,sequence:event.sequence,start_time_local:event.startTimeLocal,end_time_local:event.endTimeLocal,location_airport:event.locationAirport,raw_text:event.rawText,raw_metadata:event.rawMetadata,confidence:event.confidence })),
      p_legends: legends.map(legend => ({ code:legend.code,description:legend.description,raw_text:legend.rawText })),
    });
    if (activitiesPersisted.error) throw new Error(activitiesPersisted.error.message);
    const structure = parseFlightStructure(parsed.days);
    const structurePersisted = await supabase.rpc("persist_flight_structure", { p_import_id: importId, p_duties: structure.duties.map(duty=>({sequence:duty.sequence,start_date:duty.startDate,end_date:duty.endDate,check_in_airport:duty.checkInAirport,check_out_airport:duty.checkOutAirport,check_in_time_local:duty.checkInTimeLocal,check_out_time_local:duty.checkOutTimeLocal,check_in_outside_homebase_timezone:duty.checkInOutsideHomebaseTimezone,check_out_outside_homebase_timezone:duty.checkOutOutsideHomebaseTimezone,status:duty.status,confidence:duty.confidence,raw_metadata:duty.rawMetadata})), p_legs: structure.legs.map(leg=>({schedule_date:leg.scheduleDate,duty_sequence:leg.dutySequence,duty_link_status:leg.dutyLinkStatus,sequence:leg.sequence,leg_type:leg.legType,carrier_code:leg.carrierCode,flight_number:leg.flightNumber,origin:leg.origin,destination:leg.destination,departure_date:leg.departureDate,arrival_date:leg.arrivalDate,departure_time_local:leg.departureTimeLocal,arrival_time_local:leg.arrivalTimeLocal,departure_outside_homebase_timezone:leg.departureOutsideHomebaseTimezone,arrival_outside_homebase_timezone:leg.arrivalOutsideHomebaseTimezone,aircraft_code:leg.aircraftCode,raw_departure:leg.rawDeparture,raw_arrival:leg.rawArrival,raw_text:leg.rawText,raw_metadata:leg.rawMetadata,confidence:leg.confidence})) });
    if (structurePersisted.error) throw new Error(structurePersisted.error.message);
    const documentText = extracted.pages.map(page => reconstructSpatialLines(page.items).map(line => line.text).join("\n")).join("\n");
    const parsedMetrics = parseTimeMetrics(parsed.days, structure.duties);
    const spatialDutyMetrics = parseSpatialDutyMetrics(extracted, structure.duties);
    const spatialDocumentaryMetrics = parseSpatialDocumentaryMetrics(extracted, parsed.days);
    const calculated = calculateStructure(structure.legs, structure.duties);
    const legMetrics = calculated.calculatedLegs;
    const dutyMetrics = structure.duties.map(duty => {
      const official = spatialDutyMetrics.get(duty.sequence) ?? parsedMetrics.metrics.find(metric => metric.dutySequence === duty.sequence);
      const calculatedFlightTimeMinutes = structure.legs.filter(leg => leg.dutySequence === duty.sequence && leg.legType === "OPERATING").reduce((total, leg) => total + (legMetrics.find(metric => metric.sequence === leg.sequence)?.durationMinutes ?? 0), 0);
      return { sequence: duty.sequence, official_flight_time_minutes: official?.officialFlightTimeMinutes ?? null, official_flight_time_raw: official?.officialFlightTimeRaw ?? null, official_duty_time_minutes: official?.officialDutyTimeMinutes ?? null, official_duty_time_raw: official?.officialDutyTimeRaw ?? null, official_rest_minutes: official?.officialRestMinutes ?? null, official_rest_raw: official?.officialRestRaw ?? null, calculated_flight_time_minutes: calculatedFlightTimeMinutes, calculated_duty_time_minutes: calculated.calculatedDuties.find(metric => metric.sequence === duty.sequence)?.durationMinutes ?? null };
    });
    const footer = parseFooter(documentText);
    const calculatedFlightTime = structure.legs.filter(leg => leg.legType === "OPERATING").reduce((total, leg) => total + (legMetrics.find(metric => metric.sequence === leg.sequence)?.durationMinutes ?? 0), 0);
    const calculatedDutyTime = dutyMetrics.reduce((total, duty) => total + (duty.calculated_duty_time_minutes ?? 0), 0);
    const calculatedOffDays = activities.filter(activity => activity.eventType === "OFF").length;
    const validations = [
      ...dutyMetrics.flatMap(duty => [
        duty.official_flight_time_minutes === null || duty.official_flight_time_minutes === duty.calculated_flight_time_minutes ? [] : [{ validation_type: "OFFICIAL_VS_CALCULATED_FLIGHT_TIME", official_value: duty.official_flight_time_minutes, calculated_value: duty.calculated_flight_time_minutes, difference: duty.calculated_flight_time_minutes - duty.official_flight_time_minutes, message: "FT oficial diverge do cálculo Atlas.", metadata: { dutySequence: duty.sequence } }],
        duty.official_duty_time_minutes === null || duty.calculated_duty_time_minutes === null || duty.official_duty_time_minutes === duty.calculated_duty_time_minutes ? [] : [{ validation_type: "OFFICIAL_VS_CALCULATED_DUTY_TIME", official_value: duty.official_duty_time_minutes, calculated_value: duty.calculated_duty_time_minutes, difference: duty.calculated_duty_time_minutes - duty.official_duty_time_minutes, message: "DT oficial diverge do cálculo Atlas.", metadata: { dutySequence: duty.sequence } }],
      ]).flat(),
      ...(footer.flightTimeMinutes === null || footer.flightTimeMinutes === calculatedFlightTime ? [] : [{ validation_type: "OFFICIAL_VS_CALCULATED_MONTH_FLIGHT_TIME", official_value: footer.flightTimeMinutes, calculated_value: calculatedFlightTime, difference: calculatedFlightTime - footer.flightTimeMinutes, message: "FT mensal oficial diverge do cálculo Atlas.", metadata: {} }]),
      ...(footer.dutyTimeMinutes === null || footer.dutyTimeMinutes === calculatedDutyTime ? [] : [{ validation_type: "OFFICIAL_VS_CALCULATED_MONTH_DUTY_TIME", official_value: footer.dutyTimeMinutes, calculated_value: calculatedDutyTime, difference: calculatedDutyTime - footer.dutyTimeMinutes, message: "DT mensal oficial diverge do cálculo Atlas.", metadata: {} }]),
      ...(footer.offDays === null || footer.offDays === calculatedOffDays ? [] : [{ validation_type: "OFFICIAL_VS_CALCULATED_OFF_DAYS", official_value: footer.offDays, calculated_value: calculatedOffDays, difference: calculatedOffDays - footer.offDays, message: "Folgas oficiais divergem do cálculo Atlas.", metadata: {} }]),
    ];
    const reconciliation = reconcileFlightTime(footer.flightTimeMinutes, calculatedFlightTime);
    const timeMetricsPersisted = await supabase.rpc("persist_flight_time_metrics", { p_import_id: importId, p_footer: { flight_time_minutes: footer.flightTimeMinutes, duty_time_minutes: footer.dutyTimeMinutes, off_days: footer.offDays, off_claim: footer.offClaim }, p_leg_metrics: legMetrics.map(metric => ({ sequence: metric.sequence, departure_at_utc: metric.departureAtUtc, arrival_at_utc: metric.arrivalAtUtc, duration_minutes: metric.durationMinutes })), p_duty_metrics: dutyMetrics, p_accumulators: parsedMetrics.accumulators.map(item => ({ schedule_date: item.scheduleDate, value_minutes: item.valueMinutes, raw_value: item.rawValue, raw_text: item.rawText })), p_documentary: spatialDocumentaryMetrics.map(metric => ({ schedule_date: metric.scheduleDate, reason: metric.reason, official_flight_time_minutes: metric.officialFlightTimeMinutes, official_flight_time_raw: metric.officialFlightTimeRaw, official_duty_time_minutes: metric.officialDutyTimeMinutes, official_duty_time_raw: metric.officialDutyTimeRaw, official_rest_minutes: metric.officialRestMinutes, official_rest_raw: metric.officialRestRaw })), p_validations: validations });
    if (timeMetricsPersisted.error) throw new Error(timeMetricsPersisted.error.message);
    const dutyAudit = dutyMetrics.map(metric => ({ sequence: metric.sequence, association_status: metric.official_flight_time_minutes !== null && metric.official_duty_time_minutes !== null && metric.official_rest_minutes !== null ? "ASSOCIATED" : "UNRESOLVED", confidence: metric.official_flight_time_minutes !== null && metric.official_duty_time_minutes !== null && metric.official_rest_minutes !== null ? "HIGH" : null }));
    const metricAuditPersisted = await supabase.rpc("persist_flight_metric_audit", { p_import_id: importId, p_duty_audit: dutyAudit, p_documentary_audit: spatialDocumentaryMetrics.map(metric => ({ schedule_date: metric.scheduleDate, association_status: "ASSOCIATED", confidence: "HIGH" })), p_unresolved: [], p_ambiguous: [] });
    if (metricAuditPersisted.error) throw new Error(metricAuditPersisted.error.message);
    const complete = reconciliation.status === "VALID";
    const reconciliationPersisted = await supabase.rpc("persist_flight_schedule_reconciliation", {
      p_import_id: importId,
      p_reconciliation_status: reconciliation.status,
      p_documented_minutes: reconciliation.documentedMinutes,
      p_processed_minutes: reconciliation.processedMinutes,
      p_difference_minutes: reconciliation.differenceMinutes,
      p_missing_minutes: reconciliation.missingMinutes,
      p_threshold_minutes: reconciliation.thresholdMinutes,
      p_processing_status: complete ? status : "INCOMPLETE",
      p_error_code: complete ? null : "FLIGHT_TIME_RECONCILIATION_INCOMPLETE",
      p_error_message: complete ? null : "O FT estruturado não reconcilia com o total documental.",
    });
    if (reconciliationPersisted.error) throw new Error(reconciliationPersisted.error.message);
    return { status: complete ? "processed" : "incomplete", reconciliation };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha técnica na extração do PDF.";
    if (parserResultPersisted) {
      const failed = await supabase.rpc("persist_flight_schedule_reconciliation", {
        p_import_id: importId, p_reconciliation_status: "UNKNOWN", p_documented_minutes: null,
        p_processed_minutes: null, p_difference_minutes: null, p_missing_minutes: null,
        p_threshold_minutes: 5, p_processing_status: "FAILED", p_error_code: "SCHEDULE_PROCESSING_FAILED", p_error_message: message,
      });
      if (failed.error) throw new Error(failed.error.message);
      throw error;
    }
    const failed = await supabase.rpc("persist_flight_schedule_parser_result", {
      p_import_id: importId, p_parser_version: NETLINE_PARSER_VERSION, p_status: "FAILED", p_document_type: null, p_document_confidence: 0,
      p_crew_id: null, p_crew_name: null, p_home_base: null, p_period_start: null, p_period_end: null, p_generated_at: null,
      p_raw_text: null, p_warnings: [{ code: "PAGE_EXTRACTION_FAILED", severity: "error", message: "Não foi possível extrair o texto do PDF." }],
      p_error_code: "PAGE_EXTRACTION_FAILED", p_error_message: message, p_pages: [], p_days: [], p_unknown: [],
    });
    if (failed.error) throw new Error(failed.error.message);
    throw error;
  }
}
