/**
 * Deterministic JSON for durable payloads and dedupe keys.
 *
 * Object keys are sorted recursively while array order remains significant.
 * Unsupported object properties follow JSON semantics and are omitted; invalid
 * numbers, bigint and invalid Date values are rejected instead of being silently
 * coerced into a different durable value.
 */
export type CanonicalJsonValue =
  | null
  | string
  | boolean
  | number
  | CanonicalJsonValue[]
  | { [key: string]: CanonicalJsonValue };

export function stableJson(value: unknown): string {
  const canonical = canonicalJsonValue(value);
  if (canonical === undefined) throw new Error("durable JSON root value is unsupported");
  return JSON.stringify(canonical);
}

export function canonicalJsonValue(
  value: unknown,
  inArray = false,
): CanonicalJsonValue | undefined {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("durable JSON numbers must be finite");
    return value;
  }
  if (typeof value === "bigint") throw new Error("durable JSON does not support bigint");
  if (["undefined", "function", "symbol"].includes(typeof value)) return inArray ? null : undefined;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw new Error("durable JSON Date is invalid");
    return value.toISOString();
  }
  if (Array.isArray(value)) {
    return value.map((item) => canonicalJsonValue(item, true) ?? null);
  }
  if (typeof value === "object") {
    const output: Record<string, CanonicalJsonValue> = {};
    for (const [key, nested] of Object.entries(value).sort(([a], [b]) => a.localeCompare(b))) {
      const canonical = canonicalJsonValue(nested, false);
      if (canonical !== undefined) output[key] = canonical;
    }
    return output;
  }
  throw new Error("durable JSON contains an unsupported value");
}
