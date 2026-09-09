/** Fail-closed configuration preflight for the long-running privileged Platform worker. */
import { platformWorkerEnvironmentFailures } from "./lib/runtime-environment-policy.ts";

const failures = platformWorkerEnvironmentFailures(process.env);
if (failures.length) {
  for (const failure of failures) console.error(`error: ${failure}`);
  process.exit(1);
}
console.log("Platform worker production configuration ok");
