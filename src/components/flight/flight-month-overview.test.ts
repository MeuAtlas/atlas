import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildFlightAgenda } from "./flight-month-calendar";

const overview = readFileSync("src/components/flight/flight-month-overview.tsx", "utf8");
const agenda = readFileSync("src/components/flight/flight-month-calendar.tsx", "utf8");
const page = readFileSync("src/app/escala/page.tsx", "utf8");

test("visão unificada da escala reúne os blocos executivos sem abas internas", () => {
  for (const label of ["Escala planejada", "Escala executada", "Demonstrativo previsto", "Fixo", "Variável", "Total de proventos", "Descontos", "Total de descontos", "Líquido previsto", "Demonstrativo de diárias", "Auditoria da escala"]) assert.match(overview, new RegExp(label));
  assert.doesNotMatch(overview, /aria-label="Navegação Flight"/);
  assert.match(overview, /Base da folha/);
  assert.match(page, /flight_payroll_final_estimates/);
  assert.doesNotMatch(overview, /function ExecutiveCard/);
  assert.doesNotMatch(overview, /DOMESTIC_BREAKFAST/);
  assert.doesNotMatch(overview, /SALARY FLOOR/);
});

test("agenda usa lista compacta e preserva os tipos de operação", () => {
  assert.match(agenda, /aria-label="Agenda operacional"/);
  assert.match(agenda, /C\/I → C\/O/);
  assert.match(agenda, /Detalhes da jornada/);
  assert.match(agenda, /Voo/);
  assert.match(agenda, /Sobreaviso/);
  assert.match(agenda, /Folga/);
});

test("agenda agrupa uma leg DH e oculta os eventos documentais duplicados", () => {
  const items = buildFlightAgenda([{ date: "2026-08-02", events: [{ type: "GROUND_ACTIVITY", code: "DISP-DH", label: null, start: "13:10", end: "13:20", location: "BSB" }, { type: "DEADHEAD", code: "DH/G3", label: null, start: "13:29", end: "15:06", location: "BSB" }, { type: "COURSE", code: "C-NR06-ON", label: null, start: "08:30", end: "09:30", location: null }] }], [{ id: "leg", scheduleDate: "2026-08-02", legType: "DEADHEAD", origin: "BSB", destination: "CGH", departure: "13:29", arrival: "15:06", arrivalDate: "2026-08-02" }], []);
  assert.deepEqual(items.map(item => [item.title, item.type]), [["NR-06", "TRAINING"], ["BSB → CGH", "DEADHEAD"]]);
});

test("agenda ordena itens pelo horário real sem expor códigos técnicos", () => {
  const items = buildFlightAgenda([{ date: "2026-08-03", events: [{ type: "TRAINING", code: "C-ENS-EMG", label: null, start: "14:00", end: "15:00", location: null }, { type: "STANDBY", code: "SOBREAVIS", label: null, start: "08:00", end: "12:00", location: null }] }], [], []);
  assert.deepEqual(items.map(item => item.title), ["Sobreaviso", "Emergências presenciais"]);
  assert.equal(items.some(item => item.title.includes("C-ENS-EMG")), false);
});
