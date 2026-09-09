#!/usr/bin/env node

import { readFileSync } from "node:fs";

const failures = [];
const read = (file) => readFileSync(file, "utf8");
const migration = read("drizzle/0045_data_contract_cleanup.sql");
const afterIndexes = read("db/sql/after/0005_data_contract_indexes.sql");
const customQueries = read("src/modules/custom-fields/queries.ts");
const customActions = read("src/modules/custom-fields/actions.ts");
const publicSurfaces = read("db/sql/after/0003_public_surfaces.sql");
const platformSchema = read("src/db/schema/platform.ts");

for (const column of [
  "tenant_features ALTER COLUMN enabled TYPE boolean",
  "custom_field_definitions ALTER COLUMN required TYPE boolean",
  "workshops ALTER COLUMN public_registration TYPE boolean",
  "quality_rules ALTER COLUMN enabled TYPE boolean",
  "retention_policies ALTER COLUMN enabled TYPE boolean",
  "retention_policies ALTER COLUMN legal_hold TYPE boolean",
  "scheduled_jobs ALTER COLUMN enabled TYPE boolean",
]) {
  if (!migration.includes(column))
    failures.push(`0045 missing native boolean conversion: ${column}`);
}
for (const source of [customQueries, customActions]) {
  if (/required\s*===\s*["']true["']/.test(source))
    failures.push("custom fields reintroduced text comparison for native required boolean");
}
if (/public_registration\s*=\s*["']true["']/i.test(publicSurfaces))
  failures.push("public workshop SQL reintroduced text comparison for native boolean");

for (const constraint of [
  "jobs_payload_json_check",
  "jobs_result_json_check",
  "import_batches_mapping_json_check",
  "import_batches_faults_json_check",
  "scheduled_jobs_payload_json_check",
  "integration_staging_payload_json_check",
]) {
  if (!migration.includes(constraint))
    failures.push(`0045 missing durable JSON constraint ${constraint}`);
}

for (const column of ["target_slug", "target_username", "target_name"]) {
  if (!migration.includes(`ADD COLUMN ${column}`))
    failures.push(`0045 missing generated operation target ${column}`);
  if (!platformSchema.includes(column.replace(/_([a-z])/g, (_, c) => c.toUpperCase())))
    failures.push(`Drizzle platform schema missing generated operation target ${column}`);
}

for (const index of [
  "platform_audit_time_id_idx",
  "platform_audit_operator_search_idx",
  "platform_audit_action_search_idx",
  "platform_audit_target_search_idx",
  "platform_audit_request_search_idx",
  "platform_operation_requests_target_slug_idx",
  "platform_operation_requests_target_username_idx",
  "platform_operation_requests_target_name_idx",
]) {
  if (!new RegExp(`CREATE INDEX CONCURRENTLY IF NOT EXISTS ${index}\\b`).test(afterIndexes))
    failures.push(`large operational index is not built concurrently: ${index}`);
}
if (!afterIndexes.includes("NOT i.indisvalid") || !afterIndexes.includes("\\gexec"))
  failures.push("concurrent index rollout does not repair invalid interrupted builds");

if (failures.length) {
  console.error(
    `data-contract check failed (${failures.length} issue${failures.length === 1 ? "" : "s"}):`,
  );
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log("data-contract contract ok");
