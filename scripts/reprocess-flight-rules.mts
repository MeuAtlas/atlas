import { evaluateFlightRules } from "../src/modules/flight/rules-engine-service";

for (const importId of ["2781a9cb-a8ca-4fdb-8ba8-9260fd05de88", "8f128b7b-2a86-4626-9b10-7a22f4bffe23"]) {
  console.log(JSON.stringify(await evaluateFlightRules(importId)));
}
