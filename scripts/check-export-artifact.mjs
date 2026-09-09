import assert from "node:assert/strict";
import {
  EXPORT_ARTIFACT_TTL_MS,
  parseExportArtifactResult,
  validateExportArtifactResult,
} from "../src/lib/jobs/export-artifact.ts";

const valid = Object.freeze({
  artifactPath: "c0ffee00-0000-4000-8000-000000000000.3.csv",
  artifactSha256: "a".repeat(64),
  rowCount: 42,
  expiresAt: "2026-09-07T12:34:56.000Z",
  contentType: "text/csv; charset=utf-8",
  filename: "univ-students-2026-09-06.csv",
  size: 8192,
});

assert.equal(EXPORT_ARTIFACT_TTL_MS, 86_400_000);
assert.deepEqual(validateExportArtifactResult(valid), valid);
assert.deepEqual(parseExportArtifactResult(JSON.stringify(valid)), valid);

for (const [label, patch] of [
  ["malformed JSON", "{"],
  ["traversal path", { ...valid, artifactPath: "../secret.csv" }],
  ["dot path", { ...valid, artifactPath: ".." }],
  ["bad hash", { ...valid, artifactSha256: "ABC" }],
  ["negative rows", { ...valid, rowCount: -1 }],
  ["fractional size", { ...valid, size: 1.5 }],
  ["invalid date", { ...valid, expiresAt: "not-a-date" }],
  ["non-canonical date", { ...valid, expiresAt: "2026-09-07T12:34:56Z" }],
  ["unsafe content type", { ...valid, contentType: "text/html" }],
  ["unsafe filename", { ...valid, filename: "report/secret.csv" }],
]) {
  assert.throws(() => parseExportArtifactResult(patch), undefined, label);
}

console.log("export artifact metadata contract ok");
