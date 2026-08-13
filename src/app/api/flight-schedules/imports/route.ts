import { createHash, randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { requireFlightAccess } from "@/modules/flight/access";
import { flightScheduleStoragePath, validateFlightPdf } from "@/modules/flight/upload-validation";
import { processFlightScheduleImport, type FlightScheduleProcessingClient } from "@/modules/flight/process-schedule-import";

export const runtime = "nodejs";

function safeFilename(filename: string) {
  const cleaned = filename.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").trim();
  return cleaned.slice(0, 180) || "escala.pdf";
}

export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireFlightAccess();
    const form = await request.formData();
    const file = form.get("file");
    const year = Number(form.get("year"));
    const month = Number(form.get("month"));
    const role = form.get("role");
    if (!(file instanceof File) || !Number.isInteger(year) || !Number.isInteger(month) || (role !== "PLANNED" && role !== "EXECUTION_SNAPSHOT")) {
      return NextResponse.json({ error: { message: "Selecione um PDF e um mês operacional válido." } }, { status: 400 });
    }
    const bytes = Buffer.from(await file.arrayBuffer());
    const validationError = validateFlightPdf({ filename: file.name, mimeType: file.type, size: file.size, bytes });
    if (validationError) return NextResponse.json({ error: { message: validationError } }, { status: 422 });
    const hash = createHash("sha256").update(bytes).digest("hex");
    const path = flightScheduleStoragePath({ userId: user.id, year, month, role, fileId: randomUUID() });
    const upload = await supabase.storage.from("flight-schedules").upload(path, bytes, {
      contentType: "application/pdf", cacheControl: "private, max-age=0", upsert: false,
    });
    if (upload.error) return NextResponse.json({ error: { message: "Não foi possível armazenar a escala." } }, { status: 422 });
    const created = await supabase.rpc("create_flight_schedule_import", {
      p_year: year, p_month: month, p_role: role, p_original_filename: safeFilename(file.name),
      p_storage_path: path, p_file_size: bytes.length, p_file_hash_sha256: hash,
    });
    if (created.error) {
      await supabase.storage.from("flight-schedules").remove([path]);
      const baselineExists = /planejada já foi definida/i.test(created.error.message);
      const errorCode = created.error.code ?? "unknown";
      console.error("[Flight schedule import RPC failed]", { code: errorCode });
      return NextResponse.json({ error: {
        code: errorCode,
        message: baselineExists
          ? "A escala planejada já foi definida e não pode ser substituída."
          : `Não foi possível registrar a escala. Código: ${errorCode}.`,
      } }, { status: baselineExists ? 409 : 422 });
    }
    const result = created.data as { status: "created" | "existing"; importId: string; snapshotNumber: number | null };
    if (result.status === "existing") await supabase.storage.from("flight-schedules").remove([path]);
    if (result.status === "created") await processFlightScheduleImport(supabase as unknown as FlightScheduleProcessingClient, result.importId);
    return NextResponse.json({ status: result.status, snapshotNumber: result.snapshotNumber });
  } catch {
    return NextResponse.json({ error: { message: "Não foi possível importar a escala." } }, { status: 500 });
  }
}
