import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const processSource = readFileSync("src/modules/flight/process-schedule-import.ts", "utf8");
const orchestratorSource = readFileSync("src/modules/flight/flight-import-orchestrator.ts", "utf8");
const importRoute = readFileSync("src/app/api/flight-schedules/imports/route.ts", "utf8");
const reprocessRoute = readFileSync("src/app/api/flight-schedules/imports/[id]/reprocess/route.ts", "utf8");
const migration = readFileSync("supabase/migrations/202608140101_flight_processing_reconciliation_gate.sql", "utf8");

test("gate persiste métricas antes de decidir e bloqueia derivados no estado incompleto", () => {
  assert.ok(processSource.indexOf('rpc("persist_flight_time_metrics"') < processSource.indexOf('rpc("persist_flight_schedule_reconciliation"'));
  assert.match(orchestratorSource, /if \(outcome\.status === "incomplete"\) return outcome/);
  assert.match(importRoute, /outcome\.status === "incomplete"/);
});

test("promoção exige reconciliação válida e preserva current anterior", () => {
  assert.match(migration, /reconciliation_status <> 'VALID'/);
  assert.ok(migration.indexOf("reconciliation_status <> 'VALID'") < migration.indexOf("update public.flight_schedule_months set current_execution_import_id"));
});

test("reprocessamento exige acesso autenticado e reutiliza o PDF armazenado", () => {
  assert.match(reprocessRoute, /requireFlightAccess\(\)/);
  assert.match(orchestratorSource, /processFlightScheduleImport/);
  assert.match(processSource, /storage\.from\(imported\.data\.storage_bucket\)\.download\(imported\.data\.storage_path\)/);
  assert.match(processSource, /Arquivo original indisponível/);
});
