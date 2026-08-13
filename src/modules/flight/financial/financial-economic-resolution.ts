export type EconomicParameterForResolution = {
  id: string;
  parameter_key: string;
  role: string | null;
  value_cents: number | null;
  effective_from: string | null;
  effective_to: string | null;
  lifecycle: string;
  source_instrument_id: string | null;
  source_clause_reference: string | null;
  seniority_applicable: boolean;
};

export type EconomicResolution = {
  parameter: EconomicParameterForResolution | null;
  valueKnown: boolean;
  applicable: boolean;
  blocker: "WAITING_DOCUMENT_EFFECTIVE_DATE" | "OTHER" | null;
};

export function resolveEconomicParameter(
  parameters: readonly EconomicParameterForResolution[],
  parameterKey: string,
  role: string | null,
  date: string,
): EconomicResolution {
  const candidates = parameters.filter((item) => item.parameter_key === parameterKey && (item.role === null || item.role === role));
  const applicable = candidates.find((item) => item.value_cents !== null && item.lifecycle === "ACTIVE" && item.effective_from !== null && item.effective_from <= date && (item.effective_to === null || item.effective_to >= date)) ?? null;
  if (applicable) return { parameter: applicable, valueKnown: true, applicable: true, blocker: null };
  const known = candidates.find((item) => item.value_cents !== null) ?? null;
  return { parameter: known, valueKnown: known !== null, applicable: false, blocker: known?.effective_from === null ? "WAITING_DOCUMENT_EFFECTIVE_DATE" : "OTHER" };
}
