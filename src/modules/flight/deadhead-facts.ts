import { flightAirports } from "./time-metrics";
const countries = new Map(flightAirports.map((airport) => [airport.iata, airport.country]));
export type TransportLeg = { legType: "OPERATING" | "DEADHEAD"; origin: string | null; destination: string | null; aircraftCode: string | null };
export function deriveDutyTransportFacts(legs: TransportLeg[]) {
  const deadhead = legs.filter((leg) => leg.legType === "DEADHEAD"); const operating = legs.filter((leg) => leg.legType === "OPERATING");
  const profile = !legs.length ? "NO_LEGS" : !operating.length ? "DEADHEAD_ONLY" : !deadhead.length ? "OPERATING_ONLY" : "MIXED";
  const countriesForDeadhead = deadhead.flatMap((leg) => [leg.origin ? countries.get(leg.origin) : undefined, leg.destination ? countries.get(leg.destination) : undefined]);
  const domesticity = !deadhead.length ? "UNKNOWN" : countriesForDeadhead.length !== deadhead.length * 2 || countriesForDeadhead.some((country) => !country) ? "UNKNOWN" : new Set(countriesForDeadhead).size === 1 ? "DOMESTIC" : "INTERNATIONAL";
  return { dutyTransportProfile: profile, deadheadCount: deadhead.length, operatingLegCount: operating.length, deadheadDomesticity: domesticity, aircraftCodes: [...new Set(legs.map((leg) => leg.aircraftCode).filter((value): value is string => Boolean(value)))], internationalDeadheadOver14h: "UNKNOWN" };
}
