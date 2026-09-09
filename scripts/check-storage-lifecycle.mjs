import { readFileSync } from "node:fs";

const failures = [];
const read = (file) => readFileSync(file, "utf8");
const worker = read("scripts/job-worker.mjs");
const storageHandler = read("scripts/tenant-worker/storage-document-handlers.mjs");
const largeImport = read("src/modules/settings/large-import.ts");
const attachments = read("src/lib/documents/attachments.ts");
const documents = read("src/modules/documents/actions.ts");
const reconciliation = read("src/lib/storage/reconciliation.ts");

if (!worker.includes('"storage.reconcile": reconcileStorageObjects')) {
  failures.push("job-worker storage lifecycle registry is missing storage.reconcile");
}
for (const token of [
  "withTenantMaintenance(job.tenant_id",
  "attachmentCandidateKey",
  "importCandidateKey",
  'policy === "expiry"',
  'policy === "orphan-only"',
  "safeObjectKeyPart(tenantId)",
]) {
  if (!storageHandler.includes(token)) failures.push(`storage handler lifecycle missing ${token}`);
}
for (const token of [
  'kind: "storage.reconcile"',
  'jobDedupeKey("storage.reconcile"',
  "candidateKeys.length < 1 || candidateKeys.length > 8",
]) {
  if (!reconciliation.includes(token))
    failures.push(`storage reconciliation helper missing ${token}`);
}
for (const token of [
  'resourceType: "attachment"',
  'policy: "expiry"',
  "enqueueStorageReconcileInTx",
]) {
  if (!attachments.includes(token)) failures.push(`attachment lifecycle missing ${token}`);
}
for (const token of [
  'resourceType: "import-batch"',
  'policy: "orphan-only"',
  'policy: "cleanup-candidates"',
  'policy: "expiry"',
  'inArray(importBatches.status, ["uploading", "queued"])',
]) {
  if (!largeImport.includes(token)) failures.push(`large-import lifecycle missing ${token}`);
}
if (/objectStorage\(\)\s*\.delete\(/s.test(largeImport)) {
  failures.push("large-import reintroduced non-durable direct object deletion");
}
for (const token of [
  "enqueueStorageReconcileInTx",
  'policy: "orphan-only"',
  "await objectStorage().put(objectKey",
]) {
  if (!documents.includes(token)) failures.push(`signed-document lifecycle missing ${token}`);
}
const preRegistration = documents.indexOf("enqueueStorageReconcileInTx");
const objectPut = documents.indexOf("await objectStorage().put(objectKey");
if (preRegistration < 0 || objectPut < 0 || preRegistration > objectPut) {
  failures.push("signed-document orphan reconciliation must be registered before object PUT");
}
if (documents.includes(".delete(createdObjectKey)")) {
  failures.push("signed-document reintroduced best-effort compensating delete");
}

const largeImportSource = read("src/modules/settings/large-import.ts");
for (const token of [
  "import { importBatches, importMappingProfiles, jobs, workshops }",
  'status: "cancelled"',
  'inArray(jobs.status, ["queued", "retry"])',
]) {
  if (!largeImportSource.includes(token))
    failures.push(`large-import cancellation lifecycle missing ${token}`);
}

if (failures.length) {
  for (const failure of failures) console.error(`error: ${failure}`);
  process.exit(1);
}
console.log("storage lifecycle contract ok");
