import assert from "node:assert/strict";
import test from "node:test";
import { deriveFlightTripFacts } from "./flight-trip-facts";

const duty = (id: string, sequence: number, startAirport: string, endAirport: string, presentationAt: string, releaseAt: string) => ({ id, sequence, startAirport, endAirport, presentationAt, releaseAt });

test("derives trip continuity only between compatible duties away from base", () => {
  const result = deriveFlightTripFacts("import", "BSB", [
    duty("out", 1, "BSB", "CGH", "2026-08-02T12:00:00Z", "2026-08-02T18:00:00Z"),
    duty("return", 2, "CGH", "BSB", "2026-08-03T14:00:00Z", "2026-08-03T20:00:00Z"),
  ], new Set());
  assert.equal(result.trips.length, 1); assert.equal(result.continuities.length, 1);
  assert.equal(result.continuities[0]?.location, "CGH"); assert.equal(result.trips[0]?.endsAtBase, true);
});

test("uses RBR policy only for the temporal overnight interval", () => {
  const result = deriveFlightTripFacts("import", "BSB", [
    duty("out", 1, "BSB", "RBR", "2026-08-19T12:00:00Z", "2026-08-19T20:00:00Z"),
    duty("return", 2, "RBR", "BSB", "2026-08-21T08:00:00Z", "2026-08-21T14:00:00Z"),
  ], new Set(["RBR"]));
  assert.equal(result.overnights[0]?.hotelStatus, "WAIVED");
});

test("does not create continuity when a trip cannot be documented through the next duty", () => {
  const result = deriveFlightTripFacts("import", "BSB", [
    duty("out", 1, "BSB", "CGH", "2026-08-02T12:00:00Z", "2026-08-02T18:00:00Z"),
    duty("other", 2, "SDU", "BSB", "2026-08-03T14:00:00Z", "2026-08-03T20:00:00Z"),
  ], new Set());
  assert.equal(result.trips.length, 0); assert.equal(result.continuities.length, 0);
});

test("models documented unlinked deadheads as a trip without inventing duties", () => {
  const result = deriveFlightTripFacts("import", "BSB", [], new Set(), false, [
    { id: "dh-out", sequence: 1, dutyId: null, origin: "BSB", destination: "CGH", departureAt: "2026-08-02T16:00:00Z", arrivalAt: "2026-08-02T18:00:00Z" },
    { id: "dh-back", sequence: 2, dutyId: null, origin: "CGH", destination: "BSB", departureAt: "2026-08-03T20:00:00Z", arrivalAt: "2026-08-03T22:00:00Z" },
  ]);
  assert.equal(result.trips.length, 1); assert.equal(result.trips[0]?.startDutyId, null);
  assert.equal(result.continuities[0]?.location, "CGH");
});
