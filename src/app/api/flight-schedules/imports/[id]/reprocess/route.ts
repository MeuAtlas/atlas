import { NextResponse } from "next/server";
import { requireFlightAccess } from "@/modules/flight/access";
import { processFlightScheduleImport, type FlightScheduleProcessingClient } from "@/modules/flight/process-schedule-import";

export const runtime = "nodejs";
export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { supabase } = await requireFlightAccess();
    await processFlightScheduleImport(supabase as unknown as FlightScheduleProcessingClient, id);
    return NextResponse.json({ status: "processed" });
  } catch {
    return NextResponse.json({ error: { message: "Não foi possível reprocessar a escala." } }, { status: 422 });
  }
}
