export type StructuredLogLevel = "debug" | "info" | "warn" | "error";

export function structuredLog(
  level: StructuredLogLevel,
  event: string,
  fields?: Record<string, unknown>,
): void;
