/** Fail-closed configuration preflight for the tenant job worker. */
import { tenantWorkerEnvironmentFailures } from "./lib/runtime-environment-policy.ts";

const failures = tenantWorkerEnvironmentFailures(process.env);
if (failures.length) {
  for (const failure of failures) console.error(`error: ${failure}`);
  process.exit(1);
}
console.log("tenant worker production configuration ok");
