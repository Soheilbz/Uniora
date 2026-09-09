export const EXPORT_ARTIFACT_TTL_MS = 24 * 60 * 60 * 1000;

export interface ExportArtifactResult {
  artifactPath: string;
  artifactSha256: string;
  rowCount: number;
  expiresAt: string;
  contentType: "text/csv; charset=utf-8" | "application/json; charset=utf-8";
  filename: string;
  size: number;
}

const CONTENT_TYPES = new Set<ExportArtifactResult["contentType"]>([
  "text/csv; charset=utf-8",
  "application/json; charset=utf-8",
]);
const FILE_NAME = /^[A-Za-z0-9._-]{1,200}$/;
const SHA256 = /^[a-f0-9]{64}$/;

/** Parse and validate the durable metadata that authorizes an export download. */
export function parseExportArtifactResult(raw: unknown): ExportArtifactResult {
  let value: unknown = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch (error) {
      throw new Error("export artifact metadata contains malformed JSON", { cause: error });
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("export artifact metadata must be an object");
  }
  const record = value as Record<string, unknown>;
  const artifactPath = requiredSafeName(record.artifactPath, "artifactPath");
  const artifactSha256 = String(record.artifactSha256 ?? "").trim();
  if (!SHA256.test(artifactSha256)) throw new Error("export artifact SHA-256 is invalid");

  const rowCount = Number(record.rowCount);
  if (!Number.isSafeInteger(rowCount) || rowCount < 0) {
    throw new Error("export artifact rowCount is invalid");
  }
  const size = Number(record.size);
  if (!Number.isSafeInteger(size) || size < 0) throw new Error("export artifact size is invalid");

  const expiresAt = String(record.expiresAt ?? "");
  const expires = new Date(expiresAt);
  if (Number.isNaN(expires.getTime()) || expires.toISOString() !== expiresAt) {
    throw new Error("export artifact expiry is invalid");
  }

  const contentType = String(record.contentType ?? "");
  if (!CONTENT_TYPES.has(contentType as ExportArtifactResult["contentType"])) {
    throw new Error("export artifact content type is invalid");
  }
  const filename = requiredSafeName(record.filename, "filename");

  return {
    artifactPath,
    artifactSha256,
    rowCount,
    expiresAt,
    contentType: contentType as ExportArtifactResult["contentType"],
    filename,
    size,
  };
}

export function validateExportArtifactResult(value: unknown): ExportArtifactResult {
  return parseExportArtifactResult(value);
}

function requiredSafeName(value: unknown, label: string): string {
  const text = String(value ?? "");
  if (!FILE_NAME.test(text) || text === "." || text === "..") {
    throw new Error(`export artifact ${label} is invalid`);
  }
  return text;
}
