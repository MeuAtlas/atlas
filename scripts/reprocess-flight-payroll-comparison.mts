import { rebuildFlightPayrollComparison } from "../src/modules/flight/financial/payroll-base-decision-service";

for (const scheduleMonthId of process.argv.slice(2)) console.log(JSON.stringify(await rebuildFlightPayrollComparison(scheduleMonthId)));
