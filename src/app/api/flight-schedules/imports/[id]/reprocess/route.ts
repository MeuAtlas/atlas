import { NextResponse } from "next/server";
import { requireFlightAccess } from "@/modules/flight/access";
import { reprocessFlightSchedule } from "@/modules/flight/flight-import-orchestrator";

export const runtime = "nodejs";
export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { supabase, user } = await requireFlightAccess();
    const outcome = await reprocessFlightSchedule(supabase, id, user.id);
    return NextResponse.json(outcome, { status: outcome.status === "incomplete" ? 422 : 200 });
  } catch (error) {
    return NextResponse.json({ error: { message: error instanceof Error ? error.message : "Não foi possível reprocessar a escala." } }, { status: 422 });
  }
}
