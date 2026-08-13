import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { flightScheduleStoragePath, FLIGHT_SCHEDULE_MAX_FILE_SIZE, validateFlightPdf } from "./upload-validation";

const pdf = new Uint8Array(Buffer.from("%PDF-1.7\n"));

test("valida PDF e preserva o limite de 20 MB", () => {
  assert.equal(validateFlightPdf({ filename: "Escala.pdf", mimeType: "application/pdf", size: pdf.length, bytes: pdf }), null);
  assert.equal(validateFlightPdf({ filename: "Escala.txt", mimeType: "text/plain", size: pdf.length, bytes: pdf }), "Envie apenas arquivos PDF.");
  assert.equal(validateFlightPdf({ filename: "Escala.pdf", mimeType: "application/pdf", size: FLIGHT_SCHEDULE_MAX_FILE_SIZE + 1, bytes: pdf }), "O PDF deve ter até 20 MB.");
  assert.equal(validateFlightPdf({ filename: "Escala.pdf", mimeType: "application/pdf", size: 5, bytes: new Uint8Array([1, 2, 3, 4, 5]) }), "O arquivo enviado não é um PDF válido.");
});

test("separa PDFs planejados e executados no Storage privado", () => {
  assert.equal(flightScheduleStoragePath({ userId: "user-id", year: 2026, month: 8, role: "PLANNED", fileId: "planned-id" }), "user-id/2026/08/planned/planned-id.pdf");
  assert.equal(flightScheduleStoragePath({ userId: "user-id", year: 2026, month: 8, role: "EXECUTION_SNAPSHOT", fileId: "execution-id" }), "user-id/2026/08/execution/execution-id.pdf");
});

test("migration protege baseline, deduplicação, RLS e serialização de snapshots", () => {
  const migration = readFileSync("supabase/migrations/202608080104_flight_schedule_foundation.sql", "utf8");
  const pathFix = readFileSync("supabase/migrations/202608080105_fix_flight_schedule_storage_path_validation.sql", "utf8");
  const mimeDefault = readFileSync("supabase/migrations/202608080106_default_flight_schedule_import_mime_type.sql", "utf8");
  const deletion = readFileSync("supabase/migrations/202608080107_delete_flight_schedule_snapshots.sql", "utf8");
  const parser = readFileSync("supabase/migrations/202608080108_flight_schedule_netline_parser.sql", "utf8");
  assert.match(migration, /unique\(schedule_month_id,file_hash_sha256\)/);
  assert.match(migration, /unique\(schedule_month_id,snapshot_number\)/);
  assert.match(migration, /for update;/);
  assert.match(migration, /target_month\.planned_import_id is not null then raise exception/);
  assert.match(migration, /flight_schedule_months_owner_read/);
  assert.match(migration, /flight_schedules_select/);
  assert.match(migration, /create_flight_schedule_import/);
  assert.match(pathFix, /\[0-9a-f-\]\+\\\.pdf\$/);
  assert.match(mimeDefault, /mime_type set default 'application\/pdf'/);
  assert.match(deletion, /EXECUTION_SNAPSHOT_DELETED/);
  assert.match(deletion, /target_import\.schedule_role <> 'EXECUTION_SNAPSHOT'/);
  assert.match(deletion, /current_execution_import_id=replacement_import_id/);
  assert.match(parser, /flight_schedule_pages_owner_read/);
  assert.match(parser, /delete from public\.flight_schedule_days where import_id=p_import_id/);
  assert.match(parser, /persist_flight_schedule_parser_result/);
});
