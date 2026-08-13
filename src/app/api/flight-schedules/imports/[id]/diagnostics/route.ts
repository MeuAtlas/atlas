import { NextResponse } from "next/server";
import { requireFlightAccess } from "@/modules/flight/access";
import { buildActivityDiagnostic } from "@/modules/flight/activity-diagnostics";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params; const { supabase } = await requireFlightAccess();
    const [imported, events, legends, days, legs, duties, documentary, unresolved, ambiguous, validations] = await Promise.all([
      supabase.from("flight_schedule_imports").select("id,original_filename,parser_version,official_month_flight_time_minutes,official_month_duty_time_minutes,official_off_days,official_off_claim").eq("id", id).single(),
      supabase.from("flight_schedule_events").select("event_type,event_code").eq("import_id", id), supabase.from("flight_schedule_legends").select("code,description").eq("import_id", id).order("code"), supabase.from("flight_schedule_days").select("schedule_date,raw_text").eq("import_id", id).order("schedule_date"), supabase.from("flight_legs").select("leg_type,duty_id,duty_link_status,calculated_duration_minutes").eq("import_id", id),
      supabase.from("flight_duties").select("sequence,start_date,end_date,status,official_flight_time_minutes,official_duty_time_minutes,official_rest_minutes,calculated_flight_time_minutes,calculated_duty_time_minutes,calculated_rest_minutes,metric_association_status,metric_confidence").eq("import_id", id).order("sequence"), supabase.from("flight_schedule_documentary_metrics").select("official_flight_time_minutes,official_duty_time_minutes,official_rest_minutes,reason,schedule_day_id").eq("import_id", id), supabase.from("flight_schedule_unresolved_metrics").select("id,metric_type,reason").eq("import_id", id), supabase.from("flight_schedule_ambiguous_metrics").select("id,metric_type,reason").eq("import_id", id), supabase.from("flight_schedule_validations").select("validation_type,official_value,calculated_value,difference,message").eq("import_id", id),
    ]);
    if ([imported,events,legends,days,legs,duties,documentary,unresolved,ambiguous,validations].some(result => result.error) || !imported.data) return NextResponse.json({ error: { message: "Não foi possível carregar o diagnóstico." } }, { status: 404 });
    const base = buildActivityDiagnostic({ importId: imported.data.id, filename: imported.data.original_filename, parserVersion: imported.data.parser_version, events: events.data ?? [], legends: legends.data ?? [], days: days.data ?? [], legs: legs.data ?? [], duties: duties.data ?? [] });
    const calculatedFlight = (legs.data ?? []).filter(leg => leg.leg_type === "OPERATING").reduce((total, leg) => total + (leg.calculated_duration_minutes ?? 0), 0);
    const calculatedDuty = (duties.data ?? []).reduce((total, duty) => total + (duty.calculated_duty_time_minutes ?? 0), 0);
    return NextResponse.json({ ...base, audit: { totals: { officialFlight: imported.data.official_month_flight_time_minutes, calculatedFlight, officialDuty: imported.data.official_month_duty_time_minutes, calculatedDuty, officialOff: imported.data.official_off_days, calculatedOff: base.counts.OFF, offClaim: imported.data.official_off_claim }, duties: duties.data ?? [], documentary: documentary.data ?? [], unresolved: unresolved.data ?? [], ambiguous: ambiguous.data ?? [], validations: validations.data ?? [] } });
  } catch { return NextResponse.json({ error: { message: "Não foi possível carregar o diagnóstico." } }, { status: 500 }); }
}
