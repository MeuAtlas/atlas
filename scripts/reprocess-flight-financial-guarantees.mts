import { buildFlightFinancialGuarantees } from "../src/modules/flight/financial/financial-guarantee-service";
for (const importId of process.argv.slice(2)) console.log(JSON.stringify(await buildFlightFinancialGuarantees(importId)));
