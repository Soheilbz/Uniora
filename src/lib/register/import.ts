import { foldDigits } from "@/lib/digits.ts";
import type { AnyFieldSpec as FieldSpec } from "@/lib/register/field-spec.ts";

/** A field, as an import needs it: no group, because it draws nothing. */
export type ImportField = Omit<FieldSpec, "group">;

/**
 * Reading a spreadsheet back into a register.
 *
 * ── Why the plan is separate from the write ─────────────────────────────────
 *
 * An office importing a year's intake is holding a file somebody else prepared,
 * and the question they need answered before anything is written is «what will
 * this do» — how many records appear, how many are overwritten, and which lines
 * are wrong. A dialog that offers only «Import» and then reports what happened
 * is a dialog that asks somebody to find out by doing it.
 *
 * So this module reads and *decides*, and nothing here touches the database.
 * The action applies a plan the reader has already seen.
 *
 * ── Why the file's own words, not its keys ──────────────────────────────────
 *
 * The header row is matched against the column *labels* — «شماره دانشجویی», not
 * `studentNumber` — because those are what the export writes, and the file an
 * office edits is almost always one this application produced. A key is accepted
 * too, so a file assembled by hand from the schema also loads.
 *
 * Vocabulary cells are matched the same way: «دکتری تخصصی» first, then `phd`.
 * Nobody types `professional_doctorate` into a spreadsheet.
 */

/** One line of the file, with its number, as the reader will see it named. */
export interface ImportRow {
  /** The line in the file, counting the header as 1 — what a spreadsheet shows. */
  line: number;
  values: Record<string, string>;
}

export interface ImportFault {
  line: number;
  /** The column, in the office's own words. */
  column: string;
  reason: string;
  /** What was in the cell, so the reader can find it. */
  value: string;
}

export interface ImportPlan {
  /** Rows that name a record not on file. */
  creates: ImportRow[];
  /** Rows whose key matches a record already there. */
  updates: (ImportRow & { id: string })[];
  faults: ImportFault[];
  /** Header columns this register has no field for, named rather than dropped. */
  ignored: string[];
  /** Number of data rows in the file, excluding its header. */
  totalRows: number;
  /** Whether the plan intentionally stopped at the per-file safety limit. */
  truncated: boolean;
}

/**
 * A CSV file, as rows of cells.
 *
 * Written out rather than taken from a library because the shape is small and
 * the two rules that matter are easy to get subtly wrong: a quoted field may
 * contain the separator and the line break, and a doubled quote inside one is a
 * single quote. A parser that splits on commas reads a thesis title containing
 * one comma as two columns, and shifts every value after it into the wrong
 * field — which imports cleanly and produces nonsense.
 *
 * The leading byte-order mark is dropped: every file this application exports
 * carries one, so a parser that kept it would fail to match the very first
 * column of its own output.
 */
export function parseCsv(text: string): string[][] {
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let at = 0; at < source.length; at += 1) {
    const char = source[at];

    if (quoted) {
      if (char === '"') {
        if (source[at + 1] === '"') {
          cell += '"';
          at += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += char;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (char !== "\r") {
      cell += char;
    }
  }

  /* A file that does not end in a newline still has a last row. */
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }

  /* A trailing blank line is not a record of empty fields. */
  return rows.filter((line) => line.some((value) => value.trim() !== ""));
}

/** What a vocabulary offers, as the plan needs to resolve it. */
export interface ImportVocabulary {
  /** `set` → the entries the institution currently offers. */
  get(set: string): { value: string; label: string }[] | undefined;
}

export interface ImportRequest {
  text: string;
  /*
   * `group` is deliberately not part of this, for the reason `schemaFor` leaves
   * it out too: which heading a field is drawn under is a property of the form,
   * and the council's groups are its own. What an import reads is the key, the
   * kind and the vocabulary behind it.
   */
  fields: readonly ImportField[];
  /** `key` → the heading the export writes for it. */
  labels: Record<string, string>;
  vocabularies: ImportVocabulary;
  /** The primary key field used by ordinary single-key registers. */
  keyField: string;
  /**
   * Identity fields when a register needs more than one value to identify a
   * record. Their order is part of the identity contract and is shared with
   * the database-key reader in `import-action.ts`.
   */
  identityFields?: readonly string[];
  /** The keys already on file, so a row can be told from a correction. */
  existing: Map<string, string>;
  /** The office's words for the two refusal reasons this module can give. */
  words: {
    unknownValue: string;
    missingKey: string;
    duplicateKey: string;
    malformedCsv: string;
    tooManyRows: string;
  };
  /** How many rows a single file may carry. */
  limit: number;
}

/**
 * What a file would do, decided before anything is written.
 *
 * Every row is examined; a fault stops that row and nothing else. An office
 * given «line 41 is wrong» after forty were written has to work out which forty,
 * so the plan reports the whole file and the write applies only the sound part —
 * with the faults still on screen beside the result.
 */
/**
 * The value of one identity field as the record validator understands it.
 *
 * The plan must compare the same spelling the write path will persist. In
 * particular Persian/Arabic digits in student and sitting numbers are folded
 * before deciding Create vs Update; otherwise preview can promise a Create and
 * the validated write can collide with an existing ASCII-digit key. Row values
 * themselves are left untouched so the normal schema remains the sole writer
 * normaliser.
 */
function normalizedIdentityPart(field: ImportField | undefined, raw: unknown): string {
  const value = String(raw ?? "").trim();
  if (!field) return value;
  const numeric =
    field.format === "digits" ||
    field.format === "nationalId" ||
    field.format === "tel" ||
    field.format === "sittingNumber" ||
    field.format === "time" ||
    field.format === "clockText";
  return numeric ? foldDigits(value) : value;
}

/** One canonical identity function used by both preview and live-key loading. */
export function importIdentityKey(
  fields: readonly ImportField[],
  identityFields: readonly string[],
  values: Record<string, unknown>,
): { key: string; missingField: string | null; display: string } {
  const parts: string[] = [];
  for (const key of identityFields) {
    const field = fields.find((candidate) => candidate.key === key);
    const value = normalizedIdentityPart(field, values[key]);
    if (value === "") return { key: "", missingField: key, display: "" };
    parts.push(value);
  }
  return {
    key: parts.length === 1 ? (parts[0] ?? "") : JSON.stringify(parts),
    missingField: null,
    display: parts.join(" | "),
  };
}

/**
 * Canonicalise keys supplied by the database reader before comparing them with
 * a file. The database normally already stores folded digits, but keeping this
 * boundary canonical makes the preview correct for imported legacy rows and
 * for callers that construct the existing map from display values.
 */
function normalizeExistingIdentityKey(
  key: string,
  fields: readonly ImportField[],
  identityFields: readonly string[],
): string {
  if (identityFields.length === 1) {
    const field = fields.find((candidate) => candidate.key === identityFields[0]);
    return normalizedIdentityPart(field, key);
  }

  try {
    const parts: unknown = JSON.parse(key);
    if (Array.isArray(parts) && parts.length === identityFields.length) {
      return JSON.stringify(
        identityFields.map((fieldKey, index) =>
          normalizedIdentityPart(
            fields.find((candidate) => candidate.key === fieldKey),
            parts[index],
          ),
        ),
      );
    }
  } catch {
    /* Keep an opaque legacy key unchanged when it is not the canonical array form. */
  }
  return key;
}

function hasUnterminatedQuotedField(text: string): boolean {
  let quoted = false;
  for (let at = 0; at < text.length; at += 1) {
    if (text[at] !== '"') continue;
    if (quoted && text[at + 1] === '"') {
      at += 1;
      continue;
    }
    quoted = !quoted;
  }
  return quoted;
}

export function planImport(request: ImportRequest): ImportPlan {
  const { fields, labels, vocabularies, keyField, existing, words, limit } = request;
  const identityFields = request.identityFields?.length ? request.identityFields : [keyField];
  const existingByCanonicalKey = new Map<string, string>();
  for (const [key, id] of existing) {
    existingByCanonicalKey.set(normalizeExistingIdentityKey(key, fields, identityFields), id);
  }
  if (hasUnterminatedQuotedField(request.text)) {
    return {
      creates: [],
      updates: [],
      faults: [{ line: 1, column: "", reason: words.malformedCsv, value: "" }],
      ignored: [],
      totalRows: 0,
      truncated: false,
    };
  }
  const table = parseCsv(request.text);
  const header = table[0] ?? [];
  const allBody = table.slice(1);
  const body = allBody.slice(0, limit);

  /* Heading → field, matched on the label first and the key second. */
  const byHeading = new Map<string, ImportField>();
  for (const field of fields) {
    const label = labels[field.key];
    if (label) byHeading.set(label.trim(), field);
    byHeading.set(field.key, field);
  }

  const columns = header.map((heading) => byHeading.get(heading.trim()) ?? null);
  const ignored = header.filter((heading, at) => heading.trim() !== "" && !columns[at]);

  const creates: ImportRow[] = [];
  const updates: (ImportRow & { id: string })[] = [];
  const faults: ImportFault[] = [];
  /** Keys this file has already used, so it cannot argue with itself. */
  const seen = new Set<string>();

  body.forEach((cells, index) => {
    const line = index + 2; // the header is line 1
    const values: Record<string, string> = {};
    let sound = true;

    cells.forEach((raw, at) => {
      const field = columns[at];
      if (!field) return;
      const cell = raw.trim();
      if (cell === "") return;

      /*
       * A vocabulary cell holds the word, because that is what the export
       * wrote. Resolved back to the key it stands for; a word this institution
       * does not offer is a fault rather than a value stored as typed — an
       * unrecognised degree saved verbatim is a record that renders as its own
       * raw text on every screen afterwards.
       */
      if (field.kind === "reference") {
        const tagged = cell.match(
          /\[([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\]\s*$/i,
        );
        values[field.key] = tagged?.[1] ?? cell;
        return;
      }

      if (field.kind === "lookup" && field.set) {
        const entries = vocabularies.get(field.set) ?? [];
        const match =
          entries.find((entry) => entry.label.trim() === cell) ??
          entries.find((entry) => entry.value === cell);
        if (!match) {
          faults.push({
            line,
            column: labels[field.key] ?? field.key,
            reason: words.unknownValue,
            value: cell,
          });
          sound = false;
          return;
        }
        values[field.key] = match.value;
        return;
      }

      values[field.key] = cell;
    });

    if (!sound) return;

    /*
     * The key is what decides «new record» from «correction», so a row without
     * one cannot be filed at all. Reported rather than skipped: a file whose key
     * column was mistyped in the heading produces one fault per line, which is
     * how the reader learns the heading is wrong.
     */
    const identity = importIdentityKey(fields, identityFields, values);
    if (identity.missingField) {
      faults.push({
        line,
        column: labels[identity.missingField] ?? identity.missingField,
        reason: words.missingKey,
        value: "",
      });
      return;
    }
    const key = identity.key;

    /*
     * The same key twice in one file is the file disagreeing with itself, and
     * applying both would make the last line win silently. Both are refused, and
     * the second one is where the reader is pointed.
     */
    if (seen.has(key)) {
      faults.push({
        line,
        column: labels[keyField] ?? keyField,
        reason: words.duplicateKey,
        value: identity.display,
      });
      return;
    }
    seen.add(key);

    const id = existingByCanonicalKey.get(key);
    if (id) updates.push({ line, values, id });
    else creates.push({ line, values });
  });

  const truncated = allBody.length > limit;
  if (truncated) {
    faults.push({
      line: limit + 2,
      column: "",
      reason: words.tooManyRows,
      value: String(allBody.length),
    });
  }

  return {
    creates,
    updates,
    faults,
    ignored,
    totalRows: allBody.length,
    truncated,
  };
}

/**
 * How many rows one file may carry.
 *
 * A year's intake at a large faculty is a few hundred; two thousand is an
 * archive being moved, which is a different operation with different questions
 * and belongs to whoever administers the database. Rows past the cap are not
 * silently dropped — the plan reports the file's own length beside this number.
 */
export const IMPORT_LIMIT = 2000;

/**
 * A stored value, as the form that owns this field would have posted it.
 *
 * ── Why this is not `String(raw)` ───────────────────────────────────────────
 *
 * A boolean. The validator's rule is `z.coerce.boolean()`, which is written for
 * a checkbox — a ticked box posts «on» and an unticked one posts *nothing*. Feed
 * it the string «false» and it coerces a non-empty string to `true`, so a
 * correction to somebody's telephone number would quietly tick every unticked
 * box on their record.
 *
 * Everything else is what it looks like: a `date` column already arrives as
 * `YYYY-MM-DD`, a `numeric` as its digits, and `null` as the empty string the
 * validator reads back as «not recorded».
 */
export function asFormValue(raw: unknown, kind: string | undefined): string {
  if (raw === null || raw === undefined) return "";
  if (kind === "boolean") return raw ? "on" : "";
  return String(raw);
}
