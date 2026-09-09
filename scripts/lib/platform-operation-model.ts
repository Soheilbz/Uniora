export type PlatformRequestRow = {
  id: string;
  kind: string;
  payload: Record<string, unknown>;
  requestedBy: string;
  createdAt: Date;
};

export class PermanentOperationError extends Error {
  readonly publicCode: string;

  constructor(publicCode: string, message: string) {
    super(message);
    this.publicCode = publicCode;
    this.name = "PermanentOperationError";
  }
}

export function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function text(value: unknown): string {
  const parsed = textOrNull(value);
  if (!parsed) throw new PermanentOperationError("invalid_payload", "invalid operation payload");
  return parsed;
}

export function textOrNull(value: unknown): string | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  return value.trim();
}
function message(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}

export function safeDiagnostic(value: unknown): string {
  return message(value)
    .replace(/(password|secret|token|authorization|cookie)\s*[=:]\s*[^\s,;]+/gi, "$1=[redacted]")
    .replace(/postgres(?:ql)?:\/\/[^\s]+/gi, "postgresql://[redacted]")
    .slice(0, 240);
}
