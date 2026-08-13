import { buildFlightPayroll } from "../src/modules/flight/financial/financial-payroll-service";
for (const importId of process.argv.slice(2)) console.log(JSON.stringify(await buildFlightPayroll(importId)));
