import { NextResponse } from "next/server";
import { requireFlightAccess } from "@/modules/flight/access";
import { buildFlightFacts } from "@/modules/flight/flight-facts-service";

export const runtime = "nodejs";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const { user } = await requireFlightAccess();
    return NextResponse.json(await buildFlightFacts(id, user.id));
  } catch {
    return NextResponse.json({ error: { message: "Não foi possível reprocessar os fatos da escala." } }, { status: 422 });
  }
}
