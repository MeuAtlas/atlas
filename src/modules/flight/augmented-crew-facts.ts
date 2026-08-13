export type AugmentedCrewExternalFacts = {
  crewComposition?: unknown;
  operatingCrewCount?: unknown;
  reliefCrewCount?: unknown;
  inflightRestClass?: unknown;
  plannedInflightRestMinutes?: unknown;
  actualInflightRestMinutes?: unknown;
  performsFinalLanding?: unknown;
};

const composition = (value: unknown): "SIMPLE" | "COMPOSED" | "RELIEF" | "UNKNOWN" =>
  value === "SIMPLE" || value === "COMPOSED" || value === "RELIEF" ? value : "UNKNOWN";
const restClass = (value: unknown): "CLASS_1" | "CLASS_2" | "CLASS_3" | "UNKNOWN" =>
  value === "CLASS_1" || value === "CLASS_2" || value === "CLASS_3" ? value : "UNKNOWN";
const count = (value: unknown): number | "UNKNOWN" => typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : "UNKNOWN";
const minutes = (value: unknown): number | "UNKNOWN" => typeof value === "number" && value >= 0 ? value : "UNKNOWN";
const knownBoolean = (value: unknown): "TRUE" | "FALSE" | "UNKNOWN" => value === true || value === "TRUE" ? "TRUE" : value === false || value === "FALSE" ? "FALSE" : "UNKNOWN";

export function deriveAugmentedCrewFacts(operatingLegCount: number, externalFacts: AugmentedCrewExternalFacts = {}) {
  const crewComposition = composition(externalFacts.crewComposition);
  const inflightRestClass = restClass(externalFacts.inflightRestClass);
  const plannedInflightRestMinutes = minutes(externalFacts.plannedInflightRestMinutes);
  const performsFinalLanding = knownBoolean(externalFacts.performsFinalLanding);
  return {
    crewComposition,
    operatingCrewCount: count(externalFacts.operatingCrewCount),
    reliefCrewCount: count(externalFacts.reliefCrewCount),
    inflightRestClass,
    plannedInflightRestMinutes,
    actualInflightRestMinutes: minutes(externalFacts.actualInflightRestMinutes),
    performsFinalLanding,
    operatingLegCount,
    augmentedCrewEligibleFactsComplete: crewComposition !== "UNKNOWN"
      && inflightRestClass !== "UNKNOWN"
      && plannedInflightRestMinutes !== "UNKNOWN"
      && performsFinalLanding !== "UNKNOWN"
      && typeof operatingLegCount === "number" ? "TRUE" : "FALSE",
  };
}
