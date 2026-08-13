import { buildFlightFinancialUnits } from "../src/modules/flight/financial/financial-units-service";
import { buildFlightFinancialSpecialTime } from "../src/modules/flight/financial/financial-special-time-service";
import { buildFlightFinancialEntitlements } from "../src/modules/flight/financial/financial-entitlements-service";

for (const importId of process.argv.slice(2)) console.log(JSON.stringify({ units: await buildFlightFinancialUnits(importId), specialTime: await buildFlightFinancialSpecialTime(importId), entitlements: await buildFlightFinancialEntitlements(importId) }));
