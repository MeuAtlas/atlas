import { NextResponse } from "next/server";
import { requireFlightAccess } from "@/modules/flight/access";
import { valuePersonalDeduction, type PersonalDeduction } from "@/modules/flight/financial/financial-payroll-deductions";
import { deductionInput } from "@/modules/flight/financial/payroll-deduction-input";
import { recalculatePersonalDeductionsFromCompetence } from "@/modules/flight/financial/personal-deduction-service";

const competencePattern = /^(20\d{2})-(0[1-9]|1[0-2])$/;

function parseCompetence(value: unknown) {
  if (typeof value !== "string") return null;
  const match = competencePattern.exec(value);
  if (!match) return null;
  return { value, year: Number(match[1]), month: Number(match[2]), start: `${value}-01` };
}

function mutationError(error: { code?: string; message: string }) {
  if (error.code === "23P01") return "Já existe um desconto ou uma vigência sobreposta nesta competência.";
  if (error.code === "42501") return "Você não tem permissão para alterar este desconto.";
  if (error.code === "22023") return "A vigência informada é inválida ou já foi encerrada.";
  return "Não foi possível salvar o desconto pessoal.";
}

type DeductionRow = {
  id: string;
  deduction_group_id: string;
  name: string;
  category: string;
  calculation_type: PersonalDeduction["calculationType"];
  amount_minor_units: number | null;
  percentage_basis_points: number | null;
  deductible_from_irrf_base: boolean;
  effective_from: string;
  effective_to: string | null;
  notes: string | null;
};

function present(row: DeductionRow) {
  return {
    id: row.id,
    deductionGroupId: row.deduction_group_id,
    name: row.name,
    category: row.category,
    calculationType: row.calculation_type,
    amountMinorUnits: valuePersonalDeduction({
      id: row.id,
      name: row.name,
      calculationType: row.calculation_type,
      amountMinorUnits: row.amount_minor_units,
      percentageBasisPoints: row.percentage_basis_points,
      deductibleFromIrrfBase: row.deductible_from_irrf_base,
    }),
    deductibleFromIrrfBase: row.deductible_from_irrf_base,
    effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to,
    notes: row.notes,
  };
}

export async function GET(request: Request) {
  const { supabase, user } = await requireFlightAccess();
  const competence = parseCompetence(new URL(request.url).searchParams.get("competence"));
  if (!competence) return NextResponse.json({ error: "Competência inválida." }, { status: 400 });
  const columns = "id,deduction_group_id,name,category,calculation_type,amount_minor_units,percentage_basis_points,deductible_from_irrf_base,effective_from,effective_to,notes";
  const [result, historyResult] = await Promise.all([
    supabase.from("flight_payroll_personal_deductions").select(columns)
      .eq("user_id", user.id).lte("effective_from", competence.start)
      .or(`effective_to.is.null,effective_to.gte.${competence.start}`).order("name"),
    supabase.from("flight_payroll_personal_deductions").select(columns)
      .eq("user_id", user.id).order("effective_from", { ascending: false }),
  ]);
  if (result.error || historyResult.error) return NextResponse.json({ error: "Não foi possível carregar os descontos pessoais." }, { status: 422 });
  return NextResponse.json({ competence: competence.value, items: ((result.data ?? []) as DeductionRow[]).map(present), history: ((historyResult.data ?? []) as DeductionRow[]).map(present) });
}

export async function POST(request: Request) {
  const { supabase, user } = await requireFlightAccess();
  const body = await request.json() as Record<string, unknown>;
  const competence = parseCompetence(body.competence);
  const parsed = deductionInput.safeParse(body);
  if (!competence || !parsed.success || parsed.data.calculationType !== "FIXED" || parsed.data.amountMinorUnits === null) {
    return NextResponse.json({ error: "Dados do desconto inválidos." }, { status: 400 });
  }
  const created = await supabase.rpc("create_flight_personal_deduction", {
    p_name: parsed.data.name,
    p_amount_minor_units: parsed.data.amountMinorUnits,
    p_deductible_from_irrf_base: parsed.data.deductibleFromIrrfBase,
    p_effective_from: parsed.data.effectiveFrom,
    p_notes: parsed.data.notes ?? null,
  });
  if (created.error) return NextResponse.json({ error: mutationError(created.error) }, { status: 422 });
  const effectiveCompetence = parseCompetence(parsed.data.effectiveFrom.slice(0, 7));
  if (!effectiveCompetence) return NextResponse.json({ error: "Vigência inválida." }, { status: 400 });
  await recalculatePersonalDeductionsFromCompetence(user.id, effectiveCompetence.year, effectiveCompetence.month);
  return NextResponse.json({ status: "created", id: created.data });
}

export async function PATCH(request: Request) {
  const { supabase, user } = await requireFlightAccess();
  const body = await request.json() as Record<string, unknown>;
  const competence = parseCompetence(body.competence);
  const id = typeof body.id === "string" ? body.id : null;
  if (!competence || !id) return NextResponse.json({ error: "Dados inválidos." }, { status: 400 });

  if (body.action === "end") {
    const stopsFrom = typeof body.stopsFrom === "string" ? body.stopsFrom : null;
    if (!stopsFrom) return NextResponse.json({ error: "Competência de encerramento inválida." }, { status: 400 });
    const ended = await supabase.rpc("end_flight_personal_deduction", { p_current_id: id, p_stops_from: stopsFrom });
    if (ended.error) return NextResponse.json({ error: mutationError(ended.error) }, { status: 422 });
    const affectedCompetence = parseCompetence(stopsFrom.slice(0, 7));
    if (!affectedCompetence) return NextResponse.json({ error: "Competência de encerramento inválida." }, { status: 400 });
    await recalculatePersonalDeductionsFromCompetence(user.id, affectedCompetence.year, affectedCompetence.month);
    return NextResponse.json({ status: "ended" });
  }

  if (body.action === "version") {
    const parsed = deductionInput.safeParse(body);
    if (!parsed.success || parsed.data.calculationType !== "FIXED" || parsed.data.amountMinorUnits === null) {
      return NextResponse.json({ error: "Dados da nova vigência inválidos." }, { status: 400 });
    }
    const versioned = await supabase.rpc("version_flight_personal_deduction", {
      p_current_id: id,
      p_name: parsed.data.name,
      p_amount_minor_units: parsed.data.amountMinorUnits,
      p_deductible_from_irrf_base: parsed.data.deductibleFromIrrfBase,
      p_effective_from: parsed.data.effectiveFrom,
      p_notes: parsed.data.notes ?? null,
    });
    if (versioned.error) return NextResponse.json({ error: mutationError(versioned.error) }, { status: 422 });
    const affectedCompetence = parseCompetence(parsed.data.effectiveFrom.slice(0, 7));
    if (!affectedCompetence) return NextResponse.json({ error: "Vigência inválida." }, { status: 400 });
    await recalculatePersonalDeductionsFromCompetence(user.id, affectedCompetence.year, affectedCompetence.month);
    return NextResponse.json({ status: "versioned", id: versioned.data });
  }

  return NextResponse.json({ error: "Ação inválida." }, { status: 400 });
}
