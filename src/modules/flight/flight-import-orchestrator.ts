import type { SupabaseClient } from "@supabase/supabase-js";
import { processFlightScheduleImport, type FlightScheduleProcessingClient } from "./process-schedule-import";
import { buildFlightFacts } from "./flight-facts-service";
import { evaluateFlightRules } from "./rules-engine-service";
import { buildFlightFinancialUnits } from "./financial/financial-units-service";
import { buildFlightFinancialSpecialTime } from "./financial/financial-special-time-service";
import { buildFlightFinancialEntitlements } from "./financial/financial-entitlements-service";
import { buildFlightPayroll } from "./financial/financial-payroll-service";
import { buildFlightFinalPayrollEstimate } from "./financial/financial-payroll-final-service";
import { buildFlightPayrollTaxEstimate } from "./financial/financial-payroll-deductions-service";
import { rebuildFlightPayrollComparison } from "./financial/payroll-base-decision-service";

async function buildDerivedContext(importId: string, userId: string) {
  await buildFlightFacts(importId, userId);
  await evaluateFlightRules(importId, userId);
  await buildFlightFinancialUnits(importId, userId);
  await buildFlightFinancialSpecialTime(importId, userId);
  await buildFlightFinancialEntitlements(importId, userId);
  await buildFlightPayroll(importId, userId);
  await buildFlightFinalPayrollEstimate(importId, userId);
  await buildFlightPayrollTaxEstimate(importId, userId);
}

export async function deriveAndPromoteFlightSchedule(supabase: SupabaseClient, importId: string, userId: string) {
  await buildDerivedContext(importId, userId);
  const imported = await supabase.from("flight_schedule_imports").select("schedule_month_id,schedule_role").eq("id", importId).single();
  if (imported.error || !imported.data) throw new Error("A importação processada não pôde ser carregada.");
  const scheduleMonth = await supabase.from("flight_schedule_months").select("planned_import_id,current_execution_import_id").eq("id", imported.data.schedule_month_id).single();
  if (scheduleMonth.error || !scheduleMonth.data) throw new Error("A competência processada não pôde ser carregada.");
  const isCurrent = imported.data.schedule_role === "PLANNED" ? scheduleMonth.data.planned_import_id === importId : scheduleMonth.data.current_execution_import_id === importId;
  if (!isCurrent) {
    const promoted = await supabase.rpc("promote_flight_schedule_import", { p_import_id: importId });
    if (promoted.error) throw new Error(promoted.error.message);
  }
  const refreshed = await supabase.from("flight_schedule_months").select("planned_import_id,current_execution_import_id").eq("id", imported.data.schedule_month_id).single();
  if (refreshed.error) throw new Error("A competência promovida não pôde ser carregada.");
  if (refreshed.data?.planned_import_id && refreshed.data.current_execution_import_id) await rebuildFlightPayrollComparison(imported.data.schedule_month_id, userId);
  return { scheduleMonthId: imported.data.schedule_month_id };
}

export async function reprocessFlightSchedule(supabase: SupabaseClient, importId: string, userId: string) {
  const outcome = await processFlightScheduleImport(supabase as unknown as FlightScheduleProcessingClient, importId);
  if (outcome.status === "incomplete") return outcome;
  await deriveAndPromoteFlightSchedule(supabase, importId, userId);
  return outcome;
}
