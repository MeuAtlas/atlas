import { FlightShell } from "@/components/flight/flight-shell";
import { LegalRulesOverview, type EconomicParameterOverview, type FinancialProfileOverview, type LegalInstrumentOverview, type LegalRulesetOverview } from "@/components/flight/legal-rules-overview";
import { AtlasText } from "@/components/ui/atlas-text";
import { throwSupabaseError } from "@/lib/errors";
import { getFlightShellData, requireFlightAccess } from "@/modules/flight/access";

export const dynamic = "force-dynamic";

export default async function FlightLegalRulesPage() {
  const access = await requireFlightAccess();
  const [shellData, instrumentsResult, ruleSetsResult, rulesResult, sourcesResult, profilesResult, parametersResult] = await Promise.all([
    getFlightShellData(access),
    access.supabase.from("flight_legal_instruments").select("id,instrument_type,instrument_code,title,effective_from,effective_to,status,version,storage_path").order("created_at", { ascending: false }),
    access.supabase.from("flight_rule_sets").select("id,ruleset_code,name,effective_from,effective_to,status,version").order("effective_from", { ascending: false }),
    access.supabase.from("flight_rules").select("id,rule_key,rule_version,status,effective_from,effective_to,metadata").order("rule_key"),
    access.supabase.from("flight_rule_sources").select("rule_id"),
    access.supabase.from("flight_compensation_profiles").select("id,effective_from,effective_to,role,seniority_percentage,source_type").eq("user_id", access.user.id).order("effective_from", { ascending: false }),
    access.supabase.from("flight_economic_parameters").select("id,parameter_key,role,value_cents,value_numeric,value_unit,effective_from,lifecycle,derived,seniority_applicable").order("parameter_key").order("role"),
  ]);
  if (instrumentsResult.error || ruleSetsResult.error || rulesResult.error || sourcesResult.error || profilesResult.error || parametersResult.error) throwSupabaseError(instrumentsResult.error ?? ruleSetsResult.error ?? rulesResult.error ?? sourcesResult.error ?? profilesResult.error ?? parametersResult.error!, "carregar catálogo Flight", "Não foi possível carregar o catálogo técnico.");
  const sourceCount = new Map<string, number>();
  for (const source of sourcesResult.data ?? []) sourceCount.set(source.rule_id, (sourceCount.get(source.rule_id) ?? 0) + 1);
  const rules = (rulesResult.data ?? []).map((rule) => ({ ruleKey: rule.rule_key, ruleVersion: rule.rule_version, lifecycle: String((rule.metadata as { lifecycle?: unknown }).lifecycle ?? rule.status), effectiveFrom: rule.effective_from, effectiveTo: rule.effective_to, sourceCount: sourceCount.get(rule.id) ?? 0 }));
  return <FlightShell profile={access.profile} modules={shellData.modules} providerHealth={shellData.providerHealth}><section className="relative z-10 mx-auto my-10 grid w-full max-w-6xl gap-6 px-4 sm:px-0"><header className="grid gap-2"><AtlasText variant="pageTitle">Regras</AtlasText><AtlasText variant="pageSubtitle">Base jurídica e financeira versionada e auditável do Atlas Flight.</AtlasText></header><LegalRulesOverview instruments={(instrumentsResult.data ?? []) as LegalInstrumentOverview[]} ruleSets={(ruleSetsResult.data ?? []) as LegalRulesetOverview[]} rules={rules} financialProfiles={(profilesResult.data ?? []) as FinancialProfileOverview[]} economicParameters={(parametersResult.data ?? []) as EconomicParameterOverview[]} /></section></FlightShell>;
}
