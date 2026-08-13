import { createHash } from "node:crypto";

export type TripDuty = {
  id: string;
  sequence: number;
  presentationAt: string | null;
  releaseAt: string | null;
  startAirport: string | null;
  endAirport: string | null;
};
export type TripLeg = { id: string; sequence: number; dutyId: string | null; origin: string | null; destination: string | null; departureAt: string | null; arrivalAt: string | null };

export type FlightTrip = {
  id: string;
  importId: string;
  startDutyId: string | null;
  endDutyId: string | null;
  tripStartAt: string;
  tripEndAt: string;
  contractualBase: string;
  startsAtBase: boolean;
  endsAtBase: boolean;
  awayFromBase: boolean;
  locations: string[];
  confidence: "HIGH" | "MEDIUM" | "LOW";
  provenance: Record<string, unknown>;
};

export type FlightTripOvernight = {
  id: string;
  tripId: string;
  previousDutyId: string | null;
  nextDutyId: string | null;
  location: string;
  startAt: string;
  endAt: string;
  hotelStatus: "USED" | "WAIVED" | "UNKNOWN";
  source: "PROFILE_POLICY" | "DERIVED_TRIP_CONTINUITY";
  confidence: "HIGH" | "MEDIUM" | "LOW";
};

export type TripContinuity = {
  id: string;
  tripId: string;
  startAt: string;
  endAt: string;
  location: string;
  previousDutyId: string | null;
  nextDutyId: string | null;
  hotelStatus: FlightTripOvernight["hotelStatus"];
};

export type TripFacts = { trips: FlightTrip[]; overnights: FlightTripOvernight[]; continuities: TripContinuity[] };

function id(seed: string) {
  const hash = createHash("sha256").update(`flight-trip-facts/1.0.0:${seed}`).digest("hex");
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-${(Number.parseInt(hash.slice(16, 18), 16) & 0x3f | 0x80).toString(16)}${hash.slice(18, 20)}-${hash.slice(20, 32)}`;
}

/**
 * Builds only document-supported trips: a journey starts at base, remains away
 * through consecutive duties at the same outstation, and ends on the duty that
 * returns to contractual base. A gap with no compatible next duty is not
 * silently turned into a trip.
 */
export function deriveFlightTripFacts(importId: string, contractualBase: string | null, duties: readonly TripDuty[], hotelWaivedLocations: ReadonlySet<string>, hotelUsedByDefault = false, legs: readonly TripLeg[] = []): TripFacts {
  if (!contractualBase) return { trips: [], overnights: [], continuities: [] };
  const ordered = [...duties].filter(duty => duty.presentationAt && duty.releaseAt && duty.startAirport && duty.endAirport).sort((left, right) => left.sequence - right.sequence || left.presentationAt!.localeCompare(right.presentationAt!));
  const trips: FlightTrip[] = []; const overnights: FlightTripOvernight[] = []; const continuities: TripContinuity[] = [];
  let startIndex = -1;
  for (let index = 0; index < ordered.length; index += 1) {
    const duty = ordered[index];
    if (startIndex < 0) {
      if (duty.startAirport === contractualBase && duty.endAirport !== contractualBase) startIndex = index;
      continue;
    }
    const previous = ordered[index - 1];
    const compatible = previous.endAirport === duty.startAirport && previous.endAirport !== contractualBase && Date.parse(duty.presentationAt!) > Date.parse(previous.releaseAt!);
    if (!compatible) { startIndex = -1; if (duty.startAirport === contractualBase && duty.endAirport !== contractualBase) startIndex = index; continue; }
    if (duty.endAirport !== contractualBase) continue;
    const tripDuties = ordered.slice(startIndex, index + 1);
    const tripId = id(`${importId}:${tripDuties[0].id}:${duty.id}`);
    const trip: FlightTrip = { id: tripId, importId, startDutyId: tripDuties[0].id, endDutyId: duty.id, tripStartAt: tripDuties[0].presentationAt!, tripEndAt: duty.releaseAt!, contractualBase, startsAtBase: true, endsAtBase: true, awayFromBase: true, locations: [...new Set(tripDuties.flatMap(item => [item.startAirport!, item.endAirport!]))], confidence: "HIGH", provenance: { algorithm: "deriveFlightTripFacts", version: "flight-trip-facts/1.0.0", dutyIds: tripDuties.map(item => item.id) } };
    trips.push(trip);
    for (let tripIndex = 1; tripIndex < tripDuties.length; tripIndex += 1) {
      const previousDuty = tripDuties[tripIndex - 1]; const nextDuty = tripDuties[tripIndex]; const location = previousDuty.endAirport!;
      const waived = hotelWaivedLocations.has(location); const hotelStatus: FlightTripOvernight["hotelStatus"] = waived ? "WAIVED" : hotelUsedByDefault ? "USED" : "UNKNOWN";
      const continuityId = id(`${tripId}:continuity:${previousDuty.id}:${nextDuty.id}`);
      continuities.push({ id: continuityId, tripId, startAt: previousDuty.releaseAt!, endAt: nextDuty.presentationAt!, location, previousDutyId: previousDuty.id, nextDutyId: nextDuty.id, hotelStatus });
      overnights.push({ id: id(`${tripId}:overnight:${previousDuty.id}:${nextDuty.id}`), tripId, previousDutyId: previousDuty.id, nextDutyId: nextDuty.id, location, startAt: previousDuty.releaseAt!, endAt: nextDuty.presentationAt!, hotelStatus, source: waived ? "PROFILE_POLICY" : "DERIVED_TRIP_CONTINUITY", confidence: waived ? "HIGH" : hotelUsedByDefault ? "MEDIUM" : "LOW" });
    }
    startIndex = -1;
  }
  // Some NetLine deadheads have no C/I and C/O and therefore deliberately have
  // no duty. They still document a return trip, without inventing a duty.
  const unlinked = [...legs].filter(leg => leg.dutyId === null && leg.origin && leg.destination && leg.departureAt && leg.arrivalAt).sort((left, right) => left.sequence - right.sequence || left.departureAt!.localeCompare(right.departureAt!));
  for (let index = 0; index < unlinked.length; index += 1) {
    const outbound = unlinked[index];
    if (outbound.origin !== contractualBase || outbound.destination === contractualBase) continue;
    const inbound = unlinked.slice(index + 1).find(candidate => candidate.origin === outbound.destination && candidate.destination === contractualBase && Date.parse(candidate.departureAt!) > Date.parse(outbound.arrivalAt!));
    if (!inbound) continue;
    const tripId = id(`${importId}:legs:${outbound.id}:${inbound.id}`);
    const location = outbound.destination!; const waived = hotelWaivedLocations.has(location); const hotelStatus: FlightTripOvernight["hotelStatus"] = waived ? "WAIVED" : hotelUsedByDefault ? "USED" : "UNKNOWN";
    trips.push({ id: tripId, importId, startDutyId: null, endDutyId: null, tripStartAt: outbound.departureAt!, tripEndAt: inbound.arrivalAt!, contractualBase, startsAtBase: true, endsAtBase: true, awayFromBase: true, locations: [contractualBase, location], confidence: "MEDIUM", provenance: { algorithm: "deriveFlightTripFacts", version: "flight-trip-facts/1.0.0", documentaryLegIds: [outbound.id, inbound.id], dutyCoverage: "UNLINKED_DOCUMENT_NO_CI_CO" } });
    const continuityId = id(`${tripId}:continuity`);
    continuities.push({ id: continuityId, tripId, startAt: outbound.arrivalAt!, endAt: inbound.departureAt!, location, previousDutyId: null, nextDutyId: null, hotelStatus });
    overnights.push({ id: id(`${tripId}:overnight`), tripId, previousDutyId: null, nextDutyId: null, location, startAt: outbound.arrivalAt!, endAt: inbound.departureAt!, hotelStatus, source: waived ? "PROFILE_POLICY" : "DERIVED_TRIP_CONTINUITY", confidence: waived ? "HIGH" : hotelUsedByDefault ? "MEDIUM" : "LOW" });
  }
  return { trips, overnights, continuities };
}
