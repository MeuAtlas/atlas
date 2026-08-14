import assert from "node:assert/strict";
import test from "node:test";
import type { ExtractedPdfDocument } from "@/modules/finance/invoice-import/types";
import { calculateStructure, parseSpatialDutyMetrics } from "./time-metrics";
import type { ParsedLeg } from "./flight-structure-parser";

test("reconstrói as quatro legs BEL/MCP que explicam 7h31 do Snapshot 2", () => {
  const leg = (sequence: number, origin: string, destination: string, departure: string, arrival: string): ParsedLeg => ({ scheduleDate: "2026-08-12", sequence, dutySequence: 5, dutyLinkStatus: "LINKED", legType: "OPERATING", carrierCode: "G3", flightNumber: "2007", origin, destination, departureDate: "2026-08-12", arrivalDate: "2026-08-12", departureTimeLocal: departure, arrivalTimeLocal: arrival, departureOutsideHomebaseTimezone: false, arrivalOutsideHomebaseTimezone: false, aircraftCode: null, rawDeparture: departure.replace(":", ""), rawArrival: arrival.replace(":", ""), rawText: "", rawMetadata: {}, confidence: "HIGH" });
  const duties = [{ sequence: 4, startDate: "2026-08-11", endDate: "2026-08-11", checkInAirport: "BSB", checkOutAirport: "BEL", checkInTimeLocal: "19:00", checkOutTimeLocal: "23:00", checkInOutsideHomebaseTimezone: false, checkOutOutsideHomebaseTimezone: false, status: "COMPLETE" as const, confidence: "HIGH" as const, rawMetadata: {} }, { sequence: 5, startDate: "2026-08-12", endDate: "2026-08-12", checkInAirport: "BEL", checkOutAirport: "GIG", checkInTimeLocal: "12:00", checkOutTimeLocal: "21:00", checkInOutsideHomebaseTimezone: false, checkOutOutsideHomebaseTimezone: false, status: "COMPLETE" as const, confidence: "HIGH" as const, rawMetadata: {} }];
  const legs = [leg(8, "BSB", "BEL", "20:27", "22:48"), leg(9, "BEL", "MCP", "12:51", "13:43"), leg(10, "MCP", "BEL", "14:54", "15:48"), leg(11, "BEL", "GIG", "16:49", "20:13")];
  const result = calculateStructure(legs, duties);
  assert.equal(result.calculatedLegs.reduce((sum, item) => sum + (item.durationMinutes ?? 0), 0), 451);
  assert.ok(result.calculatedLegs.every(item => item.durationMinutes !== null));
});

test("associa FT, DT e RT separados espacialmente ao C/O correspondente", () => {
  const document = { pages: [{ items: [
    { text: "C/O", x: 63, y: 340, width: 1, height: 1, pageNumber: 1, index: 0, visualIndex: 0 },
    { text: "1420", x: 80, y: 340, width: 1, height: 1, pageNumber: 1, index: 1, visualIndex: 1 },
    { text: "RBR", x: 100, y: 340, width: 1, height: 1, pageNumber: 1, index: 2, visualIndex: 2 },
    { text: "[FT", x: 246, y: 340, width: 1, height: 1, pageNumber: 1, index: 3, visualIndex: 3 }, { text: "05:55]", x: 271, y: 340, width: 1, height: 1, pageNumber: 1, index: 4, visualIndex: 4 },
    { text: "[DT", x: 246, y: 346, width: 1, height: 1, pageNumber: 1, index: 5, visualIndex: 5 }, { text: "08:35]", x: 271, y: 346, width: 1, height: 1, pageNumber: 1, index: 6, visualIndex: 6 },
    { text: "[RT", x: 246, y: 352, width: 1, height: 1, pageNumber: 1, index: 7, visualIndex: 7 }, { text: "12:00]", x: 271, y: 352, width: 1, height: 1, pageNumber: 1, index: 8, visualIndex: 8 },
  ], pageNumber: 1, width: 1, height: 1, text: "", plainText: "", lines: [], visualLines: [] }], pageCount: 1, fullText: "", itemCount: 9, characterCount: 0, metadata: {}, extractionWarnings: [], warnings: [], extractionMethod: "pdfjs_legacy", extractorVersion: "test", quality: { characterCount: 0, nonWhitespaceCharacterCount: 0, pagesWithText: 0, knownMarkersFound: [], markersFound: [], confidence: 0, likelyImageOnly: false } } as unknown as ExtractedPdfDocument;
  const result = parseSpatialDutyMetrics(document, [{ sequence: 1, startDate: "2026-08-05", endDate: "2026-08-05", checkInAirport: "BSB", checkOutAirport: "RBR", checkInTimeLocal: "07:45", checkOutTimeLocal: "14:20", checkInOutsideHomebaseTimezone: false, checkOutOutsideHomebaseTimezone: true, status: "COMPLETE", confidence: "HIGH", rawMetadata: {} }]);
  assert.deepEqual(result.get(1), { officialFlightTimeMinutes: 355, officialFlightTimeRaw: "05:55", officialDutyTimeMinutes: 515, officialDutyTimeRaw: "08:35", officialRestMinutes: 720, officialRestRaw: "12:00" });
});

test("calcula as quatro pernas MCO do Snapshot de julho sem perder FT internacional", () => {
  const leg = (sequence: number, date: string, arrivalDate: string, origin: string, destination: string, departure: string, arrival: string): ParsedLeg => ({ scheduleDate: date, sequence, dutySequence: sequence, dutyLinkStatus: "LINKED", legType: "OPERATING", carrierCode: "G3", flightNumber: String(7600 + sequence), origin, destination, departureDate: date, arrivalDate, departureTimeLocal: departure, arrivalTimeLocal: arrival, departureOutsideHomebaseTimezone: origin === "MCO", arrivalOutsideHomebaseTimezone: destination === "MCO", aircraftCode: "B7M8", rawDeparture: departure.replace(":", ""), rawArrival: arrival.replace(":", ""), rawText: "", rawMetadata: {}, confidence: "HIGH" });
  const legs = [
    leg(1, "2026-07-09", "2026-07-09", "BSB", "MCO", "09:15", "16:27"),
    leg(2, "2026-07-11", "2026-07-11", "MCO", "BSB", "15:00", "23:57"),
    leg(3, "2026-07-26", "2026-07-26", "BSB", "MCO", "11:52", "18:55"),
    leg(4, "2026-07-27", "2026-07-28", "MCO", "BSB", "18:41", "03:34"),
  ];
  const result = calculateStructure(legs, []);
  assert.deepEqual(result.calculatedLegs.map(item => item.durationMinutes), [492, 477, 483, 473]);
  assert.equal(result.calculatedLegs.reduce((sum, item) => sum + (item.durationMinutes ?? 0), 0), 1925);
  assert.ok(result.calculatedLegs.every(item => item.timezoneMissing === null));
});

test("calcula as duas pernas NAT da Planejada de julho", () => {
  const base = { scheduleDate: "2026-07-12", dutySequence: 1, dutyLinkStatus: "LINKED" as const, legType: "OPERATING" as const, carrierCode: "G3", aircraftCode: "B738", rawMetadata: {}, confidence: "HIGH" as const };
  const legs: ParsedLeg[] = [
    { ...base, sequence: 1, flightNumber: "1710", origin: "BSB", destination: "NAT", departureDate: "2026-07-12", arrivalDate: "2026-07-12", departureTimeLocal: "08:35", arrivalTimeLocal: "11:15", departureOutsideHomebaseTimezone: false, arrivalOutsideHomebaseTimezone: false, rawDeparture: "0835", rawArrival: "1115", rawText: "" },
    { ...base, scheduleDate: "2026-07-13", sequence: 2, flightNumber: "1665", origin: "NAT", destination: "BSB", departureDate: "2026-07-13", arrivalDate: "2026-07-13", departureTimeLocal: "04:40", arrivalTimeLocal: "07:30", departureOutsideHomebaseTimezone: false, arrivalOutsideHomebaseTimezone: false, rawDeparture: "0440", rawArrival: "0730", rawText: "" },
  ];
  assert.deepEqual(calculateStructure(legs, []).calculatedLegs.map(item => item.durationMinutes), [160, 170]);
});
