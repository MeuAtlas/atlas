import { buildFlightFacts } from "../src/modules/flight/flight-facts-service";
import { evaluateFlightRules } from "../src/modules/flight/rules-engine-service";
import { buildFlightFinancialUnits } from "../src/modules/flight/financial/financial-units-service";
import { buildFlightFinancialSpecialTime } from "../src/modules/flight/financial/financial-special-time-service";
import { buildFlightFinancialEntitlements } from "../src/modules/flight/financial/financial-entitlements-service";
import { buildFlightPayroll } from "../src/modules/flight/financial/financial-payroll-service";
import { buildFlightFinalPayrollEstimate } from "../src/modules/flight/financial/financial-payroll-final-service";
import { buildFlightPayrollTaxEstimate } from "../src/modules/flight/financial/financial-payroll-deductions-service";

for (const importId of process.argv.slice(2)) {
  console.log(JSON.stringify({
    importId,
    facts: await buildFlightFacts(importId),
    rules: await evaluateFlightRules(importId),
    units: await buildFlightFinancialUnits(importId),
    specialTime: await buildFlightFinancialSpecialTime(importId),
    entitlements: await buildFlightFinancialEntitlements(importId),
    payroll: await buildFlightPayroll(importId),
    finalPayroll: await buildFlightFinalPayrollEstimate(importId),
    taxes: await buildFlightPayrollTaxEstimate(importId),
  }));
}
