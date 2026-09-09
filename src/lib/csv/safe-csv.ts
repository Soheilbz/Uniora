/** Canonical CSV serialization for every downloadable spreadsheet surface. */
export function csvScalar(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/**
 * Quote a single spreadsheet cell and neutralize formula prefixes understood by
 * Excel/LibreOffice. Leading whitespace is considered part of the prefix.
 */
export function escapeCsvCell(value: unknown): string {
  const text = csvScalar(value);
  const guarded = /^(?:[\t\r\n]|\s*[=+\-@])/.test(text) ? `'${text}` : text;
  return `"${guarded.replaceAll('"', '""')}"`;
}

/** CRLF CSV body. Every cell is quoted so all producers share one contract. */
export function serializeCsv(rows: readonly (readonly unknown[])[]): string {
  return rows.map((row) => row.map(escapeCsvCell).join(",")).join("\r\n");
}

/** UTF-8 BOM for spreadsheet compatibility with Persian/Arabic text. */
export function serializeCsvWithBom(rows: readonly (readonly unknown[])[]): string {
  return `\uFEFF${serializeCsv(rows)}`;
}
