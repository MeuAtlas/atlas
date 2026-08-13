import { buildFlightFinalPayrollEstimate } from "../src/modules/flight/financial/financial-payroll-final-service";
for (const importId of process.argv.slice(2)) console.log(JSON.stringify(await buildFlightFinalPayrollEstimate(importId)));
