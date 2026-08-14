import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { calculateInss, calculateIrrf, valuePersonalDeduction, type PersonalDeduction } from "./financial-payroll-deductions";

const stable = (value: string) => { const hash = createHash("sha256").update(`flight-tax/1.0.0:${value}`).digest("hex"); return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-${(Number.parseInt(hash.slice(16, 18), 16) & 0x3f | 0x80).toString(16)}${hash.slice(18, 20)}-${hash.slice(20, 32)}`; };

export async function buildFlightPayrollTaxEstimate(importId: string, ownerUserId?: string) {
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const { data: estimate, error } = await supabase.from("flight_payroll_final_estimates").select("user_id,gross_amount_minor_units,flight_schedule_imports!inner(document_period_start)").eq("import_id", importId).single();
  if (error || !estimate || (ownerUserId && estimate.user_id !== ownerUserId)) throw new Error("Fechamento bruto não encontrado.");
  const { data: rows, error: deductionError } = await supabase.from("flight_payroll_personal_deductions").select("id,name,calculation_type,amount_minor_units,percentage_basis_points,deductible_from_irrf_base,effective_from,effective_to").eq("user_id", estimate.user_id);
  if (deductionError) throw new Error(deductionError.message);
  const linkedImport = estimate.flight_schedule_imports as unknown as { document_period_start: string | null } | null;
  const competence = linkedImport?.document_period_start?.slice(0, 7);
  if (!competence) throw new Error("Competência documental indisponível para o cálculo tributário.");
  const competenceStart = `${competence}-01`;
  const personal: PersonalDeduction[] = (rows ?? []).filter(row => row.effective_from <= competenceStart && (!row.effective_to || row.effective_to >= competenceStart)).map(row => ({ id: row.id, name: row.name, calculationType: row.calculation_type as PersonalDeduction["calculationType"], amountMinorUnits: row.amount_minor_units, percentageBasisPoints: row.percentage_basis_points, deductibleFromIrrfBase: row.deductible_from_irrf_base }));
  const inss = calculateInss(estimate.gross_amount_minor_units); const irrf = calculateIrrf(estimate.gross_amount_minor_units, inss.amountCents, personal); const personalTotal = personal.reduce((sum, item) => sum + valuePersonalDeduction(item), 0); const id = stable(importId);
  const { error: upsert } = await supabase.from("flight_payroll_tax_estimates").upsert({ id, user_id: estimate.user_id, import_id: importId, gross_amount_minor_units: estimate.gross_amount_minor_units, inss_amount_minor_units: inss.amountCents, irrf_amount_minor_units: irrf.amountCents, personal_deductions_minor_units: personalTotal, net_amount_minor_units: estimate.gross_amount_minor_units - inss.amountCents - irrf.amountCents - personalTotal, tax_status: "COMPLETE", provenance: { engine: "flight-tax/1.0.0", inss, irrf, personal: personal.map(item => ({ id: item.id, name: item.name, amountCents: valuePersonalDeduction(item), deductibleFromIrrfBase: item.deductibleFromIrrfBase })) } });
  if (upsert) throw new Error(upsert.message);
  return { id, gross: estimate.gross_amount_minor_units, inss, irrf, personalTotal, net: estimate.gross_amount_minor_units - inss.amountCents - irrf.amountCents - personalTotal };
}
