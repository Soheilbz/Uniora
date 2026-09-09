import { existsSync, readFileSync } from "node:fs";

const failures = [];
const read = (file) => readFileSync(file, "utf8");
const requireText = (file, needle, reason) => {
  const source = read(file);
  if (!source.includes(needle)) failures.push(`${file}: ${reason}`);
};

requireText("src/db/schema/operations.ts", '"jobs"', "shared durable jobs schema is missing");
requireText(
  "db/sql/after/0001_row_level_security.sql",
  "'jobs'",
  "jobs table is missing tenant RLS",
);

const policy = read("scripts/lib/web-role-policy.mjs");
const appendOnlyBlock = policy.slice(
  policy.indexOf("WEB_APPEND_ONLY_TABLES"),
  policy.indexOf("WEB_READ_ONLY_TABLES"),
);
if (!/\bjobs\b/.test(appendOnlyBlock))
  failures.push("scripts/lib/web-role-policy.mjs: jobs must remain append-only to the Web role");

const worker = read("scripts/job-worker.mjs");
const exportHandler = read("scripts/tenant-worker/export-handler.mjs");
const controlPlane = read("scripts/tenant-worker/control-plane.mjs");
const exportRuntime = `${worker}\n${exportHandler}\n${controlPlane}`;
for (const [source, pattern, reason] of [
  [controlPlane, /for\s+update\s+skip\s+locked/i, "worker claims must be concurrent-worker safe"],
  [worker, /kind\.startsWith\("export\."\)/, "shared worker must route export job kinds"],
  [controlPlane, /makeHeartbeat/, "long-running jobs must maintain an attempt-fenced heartbeat"],
]) {
  if (!pattern.test(source)) failures.push(`export worker runtime: ${reason}`);
}
for (const [pattern, reason] of [
  [/repeatable\s+read\s+read\s+only/i, "exports must use a stable read-only snapshot"],
  [
    /assertRequesterEligible\(client,\s*job\.requested_by/i,
    "exports must re-check requester lifecycle/capabilities",
  ],
  [/artifactSha256/, "export result must publish an artifact hash"],
  [/parseExportArtifactResult/, "export expiry cleanup must validate durable artifact metadata"],
  [/validateExportArtifactResult/, "export publication must validate durable artifact metadata"],
  [/renameSync\(partial,\s*finalFile\)/, "artifacts must publish atomically"],
]) {
  if (!pattern.test(exportRuntime)) failures.push(`export runtime: ${reason}`);
}

for (const file of [
  "src/app/(app)/students/export/route.ts",
  "src/app/(app)/professors/export/route.ts",
  "src/app/(app)/council-meetings/export/route.ts",
  "src/app/(app)/council-decisions/export/route.ts",
  "src/app/(app)/workshops/export/route.ts",
]) {
  const source = read(file);
  if (!/queueExportFromRequest/.test(source))
    failures.push(`${file}: register export must enqueue through the durable adapter`);
  if (/exportTooLargeResponse|EXPORT_LIMIT/.test(source))
    failures.push(`${file}: legacy synchronous export logic remains`);
}

const exportReader = read("src/modules/settings/export-jobs.ts");
if (!/parseExportArtifactResult/.test(exportReader))
  failures.push(
    "src/modules/settings/export-jobs.ts: Web export projection must validate artifact metadata",
  );
const downloadRoute = read("src/app/(app)/settings/data/jobs/[id]/route.ts");
for (const [pattern, reason] of [
  [/metadataState !== "valid"/, "download route must reject missing/corrupt completed metadata"],
  [/statSync[\s\S]*artifactSize/, "download route must verify the published artifact size"],
  [/sha256\(file\)/, "download route must verify the published artifact hash"],
])
  if (!pattern.test(downloadRoute))
    failures.push(`src/app/(app)/settings/data/jobs/[id]/route.ts: ${reason}`);

for (const legacy of [
  "scripts/export-worker.mjs",
  "src/modules/professors/export.ts",
  "src/modules/council/exports.ts",
  "src/modules/workshops/export.ts",
])
  if (existsSync(legacy)) failures.push(`legacy export implementation remains: ${legacy}`);

const exportRoute = read("src/lib/jobs/export-route.ts");
if (/requestedAt/.test(exportRoute))
  failures.push(
    "src/lib/jobs/export-route.ts: volatile request timestamps must not participate in export dedupe",
  );
if (!/stableJson/.test(exportReader))
  failures.push(
    "src/modules/settings/export-jobs.ts: export dedupe parameters must use canonical stable JSON",
  );

const action = read("src/app/(app)/settings/data/actions.ts");
if (/export_jobs/.test(action))
  failures.push("settings data action still references the retired export_jobs queue");

const ci = read(".github/workflows/ci.yml");
if (
  !/insert into jobs\(tenant_id,requested_by,kind[\s\S]*'export\.students'/m.test(ci) ||
  !/node scripts\/job-worker\.mjs --once/.test(ci)
) {
  failures.push(".github/workflows/ci.yml: shared job-worker export drill is missing");
}
if (
  !/rc\.capability='data\.export'/.test(ci) ||
  !/export worker re-authorization drill ok/.test(ci)
) {
  failures.push(".github/workflows/ci.yml: export requester re-authorization drill is missing");
}

if (failures.length) {
  for (const failure of failures) console.error(`error: ${failure}`);
  process.exit(1);
}
console.log("export contract ok");
