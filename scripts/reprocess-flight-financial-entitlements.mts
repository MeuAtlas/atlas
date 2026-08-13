import { buildFlightFinancialEntitlements } from "../src/modules/flight/financial/financial-entitlements-service";

for (const importId of process.argv.slice(2)) console.log(JSON.stringify(await buildFlightFinancialEntitlements(importId)));
