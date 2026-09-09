import { resolve } from "node:path";
import { runNode, runPnpm } from "./lib/run-command.mjs";

const root = resolve(import.meta.dirname, "..");
const nameArg = process.argv.slice(2).find((arg) => !arg.startsWith("-")) ?? "change";
if (!/^[A-Za-z0-9._-]+$/.test(nameArg))
  throw new Error("Migration name contains unsafe characters.");

runNode(resolve(root, "scripts/check-drizzle-baseline.mjs"), ["--generation-ready"], {
  cwd: root,
  label: "Drizzle generation baseline check",
});
runPnpm(["exec", "drizzle-kit", "generate", `--name=${nameArg}`], {
  cwd: root,
  label: "Drizzle migration generation",
});
