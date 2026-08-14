import { createHash, randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { requireFlightAccess } from "@/modules/flight/access";
import { flightScheduleStoragePath, validateFlightPdf } from "@/modules/flight/upload-validation";
import { deriveAndPromoteFlightSchedule, reprocessFlightSchedule } from "@/modules/flight/flight-import-orchestrator";
import { extractPdfText } from "@/modules/finance/invoice-import/extract-pdf";
import { parseNetlineDocument } from "@/modules/flight/netline-parser";

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
    let year = Number(form.get("year"));
    let month = Number(form.get("month"));
    const role = form.get("role");
    if (!(file instanceof File) || !Number.isInteger(year) || !Number.isInteger(month) || (role !== "PLANNED" && role !== "EXECUTION_SNAPSHOT")) {
      return NextResponse.json({ error: { message: "Selecione um PDF e um mês operacional válido." } }, { status: 400 });
    }
    const bytes = Buffer.from(await file.arrayBuffer());
    const validationError = validateFlightPdf({ filename: file.name, mimeType: file.type, size: file.size, bytes });
    if (validationError) return NextResponse.json({ error: { message: validationError } }, { status: 422 });
    const parsed = parseNetlineDocument(await extractPdfText(new Blob([bytes], { type: "application/pdf" })));
    const documentPeriod = parsed.periodStart;
    if (documentPeriod) {
      const detectedYear = Number(documentPeriod.slice(0, 4));
      const detectedMonth = Number(documentPeriod.slice(5, 7));
      if ((detectedYear !== year || detectedMonth !== month) && form.get("confirmDocumentCompetence") !== "true") {
        return NextResponse.json({ error: { code: "DOCUMENT_COMPETENCE_MISMATCH", message: `A escala enviada pertence a ${new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric" }).format(new Date(detectedYear, detectedMonth - 1, 1))}.` }, detectedCompetence: { year: detectedYear, month: detectedMonth } }, { status: 409 });
      }
      year = detectedYear;
      month = detectedMonth;
    }
    const hash = createHash("sha256").update(bytes).digest("hex");
    const path = flightScheduleStoragePath({ userId: user.id, year, month, role, fileId: randomUUID() });
    const upload = await supabase.storage.from("flight-schedules").upload(path, bytes, {
      contentType: "application/pdf", cacheControl: "private, max-age=0", upsert: false,
    });
    if (upload.error) return NextResponse.json({ error: { message: "Não foi possível armazenar a escala." } }, { status: 422 });
    const created = await supabase.rpc("stage_flight_schedule_import", {
      p_year: year, p_month: month, p_role: role, p_original_filename: safeFilename(file.name),
      p_storage_path: path, p_file_size: bytes.length, p_file_hash_sha256: hash,
    });
    if (created.error) {
      await supabase.storage.from("flight-schedules").remove([path]);
      const errorCode = created.error.code ?? "unknown";
      console.error("[Flight schedule import RPC failed]", { code: errorCode });
      return NextResponse.json({ error: {
        code: errorCode,
        message: `Não foi possível registrar a escala. Código: ${errorCode}.`,
      } }, { status: 422 });
    }
    const result = created.data as { status: "staged" | "existing"; importId: string };
    if (result.status === "existing") {
      await supabase.storage.from("flight-schedules").remove([path]);
      const existing = await supabase
        .from("flight_schedule_imports")
        .select("id,schedule_month_id,schedule_role,status,superseded_at")
        .eq("id", result.importId)
        .maybeSingle();
      if (existing.error || !existing.data) {
        return NextResponse.json({ error: { message: "A escala existente nÃ£o pÃ´de ser carregada." } }, { status: 422 });
      }
      const scheduleMonth = await supabase
        .from("flight_schedule_months")
        .select("planned_import_id,current_execution_import_id")
        .eq("id", existing.data.schedule_month_id)
        .maybeSingle();
      if (scheduleMonth.error) {
        return NextResponse.json({ error: { message: "A competÃªncia da escala existente nÃ£o pÃ´de ser carregada." } }, { status: 422 });
      }
      const isCurrent = existing.data.schedule_role === "PLANNED"
        ? scheduleMonth.data?.planned_import_id === existing.data.id
        : scheduleMonth.data?.current_execution_import_id === existing.data.id;
      if (existing.data.status === "INCOMPLETE" || existing.data.status === "FAILED") {
        const outcome = await reprocessFlightSchedule(supabase, existing.data.id, user.id);
        return NextResponse.json({ ...outcome, competence: { year, month } }, { status: outcome.status === "incomplete" ? 422 : 200 });
      }
      const canRecover = !isCurrent
        && existing.data.superseded_at === null
        && (existing.data.status === "PROCESSED" || existing.data.status === "PROCESSED_WITH_WARNINGS");
      if (canRecover) {
        await deriveAndPromoteFlightSchedule(supabase, existing.data.id, user.id);
        const refreshedMonth = await supabase
          .from("flight_schedule_months")
          .select("planned_import_id,current_execution_import_id")
          .eq("id", existing.data.schedule_month_id)
          .maybeSingle();
        if (refreshedMonth.error) return NextResponse.json({ error: { message: "A escala foi recuperada, mas a competÃªncia nÃ£o pÃ´de ser carregada." } }, { status: 422 });
        return NextResponse.json({ status: "recovered", competence: { year, month } });
      }
    }
    if (result.status === "staged") {
      const outcome = await reprocessFlightSchedule(supabase, result.importId, user.id);
      if (outcome.status === "incomplete") return NextResponse.json({ ...outcome, competence: { year, month } }, { status: 422 });
    }
    return NextResponse.json({ status: result.status, competence: { year, month } });
  } catch {
    return NextResponse.json({ error: { message: "Não foi possível importar a escala." } }, { status: 500 });
  }
}
