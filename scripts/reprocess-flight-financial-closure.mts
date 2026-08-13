import { buildFlightFinancialMonthlyClosure } from "../src/modules/flight/financial/financial-closure-service";
for (const importId of process.argv.slice(2)) console.log(JSON.stringify(await buildFlightFinancialMonthlyClosure(importId)));
