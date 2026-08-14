import { createClient } from "@supabase/supabase-js";
import { reprocessFlightSchedule } from "../src/modules/flight/flight-import-orchestrator";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const importIds = process.argv.slice(2);

if (!url || !serviceRoleKey) throw new Error("As credenciais de servidor do Supabase não foram configuradas.");
if (importIds.length === 0) throw new Error("Informe ao menos um import_id.");

const supabase = createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });

for (const importId of importIds) {
  const owner = await supabase.from("flight_schedule_imports").select("user_id").eq("id", importId).single();
  if (owner.error || !owner.data) throw new Error(owner.error?.message ?? "Proprietário da importação não encontrado.");
  const outcome = await reprocessFlightSchedule(supabase, importId, owner.data.user_id);
  const [{ data: imported, error: importError }, { data: duties, error: dutyError }, { data: legs, error: legError }, { data: events, error: eventError }, { data: legends, error: legendError }] = await Promise.all([
    supabase.from("flight_schedule_imports").select("id,original_filename,status,processing_warnings,processing_error_code,reconciliation_status,documented_flight_time_minutes,processed_flight_time_minutes,missing_flight_time_minutes").eq("id", importId).single(),
    supabase.from("flight_duties").select("id,status").eq("import_id", importId),
    supabase.from("flight_legs").select("id,leg_type,duty_id,duty_link_status").eq("import_id", importId),
    supabase.from("flight_schedule_events").select("id").eq("import_id", importId),
    supabase.from("flight_schedule_legends").select("id").eq("import_id", importId),
  ]);
  if (importError || dutyError || legError || eventError || legendError || !imported || !duties || !legs || !events || !legends) {
    throw new Error(importError?.message ?? dutyError?.message ?? legError?.message ?? eventError?.message ?? legendError?.message ?? "Não foi possível consultar o resultado do reprocessamento.");
  }
  const summary = {
    importId: imported.id,
    filename: imported.original_filename,
    status: imported.status,
    duties: duties.length,
    operating: legs.filter(leg => leg.leg_type === "OPERATING").length,
    deadhead: legs.filter(leg => leg.leg_type === "DEADHEAD").length,
    totalLegs: legs.length,
    open: duties.filter(duty => duty.status === "OPEN").length,
    ambiguous: duties.filter(duty => duty.status === "AMBIGUOUS").length,
    linkedLegs: legs.filter(leg => leg.duty_link_status === "LINKED").length,
    unlinkedDocumental: legs.filter(leg => leg.duty_link_status === "UNLINKED_DOCUMENT_NO_CI_CO").length,
    unlinkedAmbiguous: legs.filter(leg => leg.duty_link_status === "UNLINKED_AMBIGUOUS").length,
    events: events.length,
    legends: legends.length,
    warnings: imported.processing_warnings,
    processingErrorCode: imported.processing_error_code,
    reconciliation: outcome.reconciliation,
  };
  console.log(JSON.stringify(summary));
}
