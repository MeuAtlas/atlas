import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { decidePayrollBase } from "./payroll-base-decision";
import { buildFlightFinalPayrollEstimate } from "./financial-payroll-final-service";
import { buildFlightPayroll } from "./financial-payroll-service";
import { buildFlightPayrollTaxEstimate } from "./financial-payroll-deductions-service";

const stableId = (value: string) => {
  const hash = createHash("sha256").update(`flight-payroll-base-decision/1.0.0:${value}`).digest("hex");
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-${(Number.parseInt(hash.slice(16, 18), 16) & 0x3f | 0x80).toString(16)}${hash.slice(18, 20)}-${hash.slice(20, 32)}`;
};

type ScheduleMonth = { id: string; user_id: string; year: number; month: number; planned_import_id: string | null; current_execution_import_id: string | null };

export async function rebuildFlightPayrollComparison(scheduleMonthId: string, ownerUserId?: string, options: { refreshGross?: boolean } = {}) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Credenciais de servidor indisponíveis.");
  const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const monthResult = await supabase.from("flight_schedule_months").select("id,user_id,year,month,planned_import_id,current_execution_import_id").eq("id", scheduleMonthId).maybeSingle();
  const month = monthResult.data as ScheduleMonth | null;
  if (monthResult.error || !month || (ownerUserId && month.user_id !== ownerUserId)) throw new Error("Competência de escala não encontrada.");
  if (!month.planned_import_id || !month.current_execution_import_id) throw new Error("Planejada ou execução corrente indisponível para comparação.");

  for (const importId of [month.planned_import_id, month.current_execution_import_id]) {
    if (options.refreshGross !== false) {
      await buildFlightPayroll(importId, month.user_id);
      await buildFlightFinalPayrollEstimate(importId, month.user_id);
    }
    await buildFlightPayrollTaxEstimate(importId, month.user_id);
  }

  const [estimatesResult, taxesResult] = await Promise.all([
    supabase.from("flight_payroll_final_estimates").select("import_id,gross_amount_minor_units").in("import_id", [month.planned_import_id, month.current_execution_import_id]),
    supabase.from("flight_payroll_tax_estimates").select("import_id,net_amount_minor_units").in("import_id", [month.planned_import_id, month.current_execution_import_id]),
  ]);
  if (estimatesResult.error || taxesResult.error) throw new Error(estimatesResult.error?.message ?? taxesResult.error?.message ?? "Estimativas financeiras indisponíveis.");
  const grossByImport = new Map((estimatesResult.data ?? []).map(item => [item.import_id, item.gross_amount_minor_units]));
  const netByImport = new Map((taxesResult.data ?? []).map(item => [item.import_id, item.net_amount_minor_units]));
  const decision = decidePayrollBase({ plannedGrossCents: grossByImport.get(month.planned_import_id) ?? null, executedGrossCents: grossByImport.get(month.current_execution_import_id) ?? null });
  const id = stableId(`${month.id}:${month.planned_import_id}:${month.current_execution_import_id}`);
  const persisted = await supabase.from("flight_payroll_base_decisions").upsert({
    id,
    user_id: month.user_id,
    schedule_month_id: month.id,
    year: month.year,
    month: month.month,
    planned_import_id: month.planned_import_id,
    executed_import_id: month.current_execution_import_id,
    planned_gross_amount_minor_units: decision.plannedGrossCents,
    executed_gross_amount_minor_units: decision.executedGrossCents,
    planned_net_amount_minor_units: netByImport.get(month.planned_import_id) ?? null,
    executed_net_amount_minor_units: netByImport.get(month.current_execution_import_id) ?? null,
    selected_scenario: decision.selectedScenario,
    gross_difference_minor_units: decision.grossDifferenceCents,
    decision_reason: decision.reason,
    engine_version: "flight-payroll-base-decision/1.0.0",
    provenance: { comparator: "gross_amount_minor_units", excludes: ["diems", "flight_time", "duty_time", "net_amount_minor_units"] },
  });
  if (persisted.error) throw new Error(persisted.error.message);
  return { scheduleMonthId: month.id, plannedImportId: month.planned_import_id, executedImportId: month.current_execution_import_id, ...decision, plannedNetCents: netByImport.get(month.planned_import_id) ?? null, executedNetCents: netByImport.get(month.current_execution_import_id) ?? null };
}
