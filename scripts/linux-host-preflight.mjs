import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

if (process.platform !== "linux") {
  throw new Error(`Linux host preflight requires Linux; current platform is ${process.platform}`);
}
const script = resolve(import.meta.dirname, "../deploy/host-preflight.sh");
const result = spawnSync("bash", [script], {
  cwd: resolve(import.meta.dirname, ".."),
  env: process.env,
  stdio: "inherit",
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
