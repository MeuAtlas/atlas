import { createClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL; const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("Supabase server credentials are required.");
const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
for (const importId of process.argv.slice(2)) {
  const [source, result] = await Promise.all([
    supabase.from("flight_schedule_imports").select("original_filename").eq("id", importId).single(),
    supabase.from("flight_financial_entitlements").select("id,entitlement_type,eligibility_status,currency,amount_minor_units,location,provenance").eq("import_id", importId).order("id"),
  ]);
  if (source.error || result.error) throw new Error(source.error?.message ?? result.error?.message);
  const entries = result.data ?? []; const counts: Record<string, number> = {}; const totals: Record<string, { knownMinorUnits: number; unknownAmountCount: number }> = {};
  for (const entry of entries) { const key = `${entry.entitlement_type}:${entry.eligibility_status}`; counts[key] = (counts[key] ?? 0) + 1; if (entry.eligibility_status === "ELIGIBLE") { const currency = entry.currency ?? "UNKNOWN"; const total = totals[currency] ??= { knownMinorUnits: 0, unknownAmountCount: 0 }; if (entry.amount_minor_units === null) total.unknownAmountCount += 1; else total.knownMinorUnits += entry.amount_minor_units; } }
  const rbr = entries.filter(entry => entry.location === "RBR").map(entry => ({ type: entry.entitlement_type, status: entry.eligibility_status, hotelWaived: (entry.provenance as { hotelWaived?: unknown }).hotelWaived, breakfastIncluded: (entry.provenance as { hotelBreakfastIncluded?: unknown }).hotelBreakfastIncluded }));
  console.log(JSON.stringify({ importId, filename: source.data.original_filename, count: entries.length, counts, totals, rbr, idsSha256: createHash("sha256").update(entries.map(entry => entry.id).join(",")).digest("hex") }));
}
