import { cpSync, existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const dist = process.env.NEXT_DIST_DIR?.trim() || ".next";
const standalone = join(root, dist, "standalone");
const staticSource = join(root, dist, "static");
const staticTarget = join(standalone, dist, "static");
const publicSource = join(root, "public");
const publicTarget = join(standalone, "public");

if (!existsSync(join(standalone, "server.js"))) {
  throw new Error(
    `Missing Next standalone server at ${join(standalone, "server.js")}. Run next build first.`,
  );
}
if (!existsSync(staticSource))
  throw new Error(`Missing Next static build output at ${staticSource}`);
mkdirSync(join(standalone, dist), { recursive: true });
cpSync(staticSource, staticTarget, { recursive: true, force: true });
if (existsSync(publicSource)) cpSync(publicSource, publicTarget, { recursive: true, force: true });
console.log(`Prepared self-contained Next standalone artifact at ${standalone}`);
