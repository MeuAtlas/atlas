import { NextResponse } from "next/server";
import { requireFlightAccess } from "@/modules/flight/access";
import { evaluateFlightRules } from "@/modules/flight/rules-engine-service";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { user } = await requireFlightAccess();
  try {
    return NextResponse.json(await evaluateFlightRules(id, user.id));
  } catch {
    return NextResponse.json({ error: { message: "Não foi possível reprocessar as avaliações da escala." } }, { status: 422 });
  }
}
