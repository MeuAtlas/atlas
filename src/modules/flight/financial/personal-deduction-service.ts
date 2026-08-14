import { createClient } from "@supabase/supabase-js";
import { buildFlightPayrollTaxEstimate } from "./financial-payroll-deductions-service";
import { rebuildFlightPayrollComparison } from "./payroll-base-decision-service";

type ScheduleMonth = { id: string; year: number; month: number; planned_import_id: string | null; current_execution_import_id: string | null };

async function recalculateMonth(userId: string, scheduleMonth: ScheduleMonth) {
  const importIds = [scheduleMonth.planned_import_id, scheduleMonth.current_execution_import_id]
    .filter((id): id is string => typeof id === "string");
  if (scheduleMonth.planned_import_id && scheduleMonth.current_execution_import_id) {
    await rebuildFlightPayrollComparison(scheduleMonth.id, userId, { refreshGross: false });
  } else {
    for (const importId of importIds) await buildFlightPayrollTaxEstimate(importId, userId);
  }
  return importIds.length;
}

function competenceKey(year: number, month: number) {
  return year * 100 + month;
}

async function scheduleMonthsForUser(userId: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Credenciais de servidor indisponíveis.");
  const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const result = await supabase.from("flight_schedule_months")
    .select("id,year,month,planned_import_id,current_execution_import_id")
    .eq("user_id", userId).order("year").order("month");
  if (result.error) throw new Error(result.error.message);
  return (result.data ?? []) as ScheduleMonth[];
}

export async function recalculatePersonalDeductionsForCompetence(userId: string, year: number, month: number) {
  const scheduleMonth = (await scheduleMonthsForUser(userId)).find(item => item.year === year && item.month === month);
  return { recalculatedMonths: scheduleMonth ? 1 : 0, recalculatedImports: scheduleMonth ? await recalculateMonth(userId, scheduleMonth) : 0 };
}

export async function recalculatePersonalDeductionsFromCompetence(userId: string, year: number, month: number) {
  const start = competenceKey(year, month);
  const scheduleMonths = (await scheduleMonthsForUser(userId)).filter(item => competenceKey(item.year, item.month) >= start);
  let recalculatedImports = 0;
  for (const scheduleMonth of scheduleMonths) recalculatedImports += await recalculateMonth(userId, scheduleMonth);
  return { recalculatedMonths: scheduleMonths.length, recalculatedImports };
}
