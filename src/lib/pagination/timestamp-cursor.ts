export interface TimestampCursor {
  createdAt: Date;
  id: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function encodeTimestampCursor(row: { createdAt: Date; id: string }): string {
  return Buffer.from(JSON.stringify([row.createdAt.toISOString(), row.id]), "utf8").toString(
    "base64url",
  );
}

export function decodeTimestampCursor(raw: string | undefined | null): TimestampCursor | null {
  if (!raw || raw.length > 256) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    if (!Array.isArray(parsed) || parsed.length !== 2) return null;
    const [dateText, id] = parsed;
    if (typeof dateText !== "string" || typeof id !== "string" || !UUID.test(id)) return null;
    const createdAt = new Date(dateText);
    if (Number.isNaN(createdAt.getTime())) return null;
    return { createdAt, id };
  } catch {
    return null;
  }
}
