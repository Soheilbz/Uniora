export interface AuditChange {
  field: string;
  from: unknown;
  to: unknown;
}

export function parseAuditChanges(raw: string | null | undefined): AuditChange[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return [];
  return Object.entries(parsed as Record<string, unknown>).map(([field, value]) => {
    const shaped = typeof value === "object" && value !== null && !Array.isArray(value);
    const pair = shaped ? (value as Record<string, unknown>) : null;
    return { field, from: pair?.from ?? null, to: shaped ? (pair?.to ?? null) : value };
  });
}

export function formatAuditChanges(raw: string | null | undefined, maxLength = 1200): string {
  if (!raw) return "—";
  try {
    const parsed: unknown = JSON.parse(raw);
    return JSON.stringify(parsed, null, 2) ?? raw.slice(0, maxLength);
  } catch {
    return raw.slice(0, maxLength);
  }
}
