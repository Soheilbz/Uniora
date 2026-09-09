import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const failures = [];
function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) yield* walk(path);
    else if (/\.(ts|tsx)$/.test(path) && !/\.test\.(ts|tsx)$/.test(path)) yield path;
  }
}
function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}
function wording(catalogue, path) {
  let node = catalogue;
  for (const part of path.split(".")) {
    if (!node || typeof node !== "object") return undefined;
    node = node[part];
  }
  return node;
}
const actions = new Set();
const entities = new Set();
for (const file of walk(join(ROOT, "src"))) {
  const rel = relative(ROOT, file).split(sep).join("/");
  const source = readFileSync(file, "utf8");
  if (/\.insert\(auditLog\)/.test(source) && rel !== "src/lib/audit-writer-core.ts") {
    failures.push(`${rel}: direct audit_log insert bypasses the central writer`);
  }
  const writesAudit = /write(?:Auth)?AuditEvent\s*\(|insert\(auditLog\)/.test(source);
  if (writesAudit) {
    for (const match of source.matchAll(/entityType:\s*"([a-z_]+)"/g)) entities.add(match[1]);
    for (const match of source.matchAll(/action:\s*([\s\S]{0,180}?)\s*,\s*\n\s*entityType:/g)) {
      for (const literal of (match[1] ?? "").matchAll(/"([a-z_.]+)"/g)) actions.add(literal[1]);
    }
  }
  for (const match of source.matchAll(
    /recordSecurityFailure\([\s\S]{0,360}?"(auth\.[a-z_.]+)"\s*,?\s*\)/g,
  )) {
    actions.add(match[1]);
  }
}
for (const lang of ["en", "fa"]) {
  const catalogue = readJson(join(ROOT, `src/messages/${lang}.json`));
  for (const action of actions) {
    if (typeof wording(catalogue, `settings.audit.action.${action}`) !== "string")
      failures.push(`${lang}: missing audit action ${action}`);
  }
  for (const entity of entities) {
    if (typeof wording(catalogue, `settings.audit.entity.${entity}`) !== "string")
      failures.push(`${lang}: missing audit entity ${entity}`);
  }
}
const proxy = readFileSync(join(ROOT, "src/proxy.ts"), "utf8");
if (
  !/crypto\.randomUUID\(\)/.test(proxy) ||
  !/requestHeaders\.set\("x-request-id", requestId\)/.test(proxy)
)
  failures.push("proxy: request id is not server-generated/overwritten");
if (/matcher[\s\S]{0,500}api\/auth/.test(proxy))
  failures.push("proxy: /api/auth must not bypass server request-id generation");
if (failures.length) {
  for (const x of failures) console.error(`error: ${x}`);
  process.exit(1);
}
console.log(`audit contract ok (${entities.size} entity types, ${actions.size} actions)`);
