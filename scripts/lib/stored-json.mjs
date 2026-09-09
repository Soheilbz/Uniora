import { PermanentJobError } from "./job-errors.mjs";

/** Parse durable JSON state without silently converting corruption to defaults. */
export function parseStoredObject(raw, label, maxBytes = 1_000_000) {
  const value = parseStoredJson(raw, label, maxBytes);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new PermanentJobError(`${label} must contain a JSON object`);
  }
  return value;
}

/** Parse durable JSON array state without silently discarding malformed data. */
export function parseStoredArray(raw, label, maxBytes = 2_000_000) {
  const value = parseStoredJson(raw, label, maxBytes);
  if (!Array.isArray(value)) {
    throw new PermanentJobError(`${label} must contain a JSON array`);
  }
  return value;
}

function parseStoredJson(raw, label, maxBytes) {
  if (raw !== null && typeof raw === "object") return raw;
  if (typeof raw !== "string") {
    throw new PermanentJobError(`${label} is missing or is not JSON`);
  }
  if (Buffer.byteLength(raw, "utf8") > maxBytes) {
    throw new PermanentJobError(`${label} exceeds the durable JSON size limit`);
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new PermanentJobError(`${label} contains malformed JSON`, { cause: error });
  }
}
