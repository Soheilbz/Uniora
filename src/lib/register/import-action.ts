import { and, eq, inArray, isNull, or, type SQL } from "drizzle-orm";
import type { AnyPgColumn, PgTable } from "drizzle-orm/pg-core";
import { getTranslations } from "next-intl/server";
import type { z } from "zod";
import { readOnly } from "@/db/tenant.ts";
import { lookupTable } from "@/lib/lookups.ts";
import { same } from "@/lib/register/changes.ts";
import { IMPORT_LIMIT, type ImportField, importIdentityKey, planImport } from "./import.ts";
import {
  applyImport,
  type ImportDomainValidator,
  type ImportOutcome,
  type RollbackOutcome,
  rollbackImport,
} from "./import-write.ts";

/**
 * The one shape every register's import takes.
 *
 * ── Why the file is read twice ──────────────────────────────────────────────
 *
 * Once to say what it would do, and once — after the reader has agreed — to do
 * it. The alternative is holding a parsed plan on the server between two
 * requests, which means a session-scoped store, an expiry, and a plan that can
 * be applied against a register that changed underneath it. Re-reading is a few
 * hundred rows of text and removes all three.
 *
 * It also means the second pass sees the register as it is *now*: a student
 * somebody else entered in the meantime is a correction rather than a duplicate
 * key, which is the answer an office would expect.
 *
 * ── What a caller supplies ──────────────────────────────────────────────────
 *
 * Its table, its fields, its validator, and the column that says which record a
 * row is about. Nothing else differs between the five registers.
 */

export interface ImportSpec<Schema extends z.ZodType> {
  table: PgTable;
  id: AnyPgColumn;
  deletedAt: AnyPgColumn;
  /** The optimistic-concurrency column corrections are guarded by. */
  version: AnyPgColumn;
  /** The column a row is identified by — a student number, a professor code. */
  keyColumn: AnyPgColumn;
  keyField: string;
  /** Composite identity for registers whose natural key spans several fields. */
  identity?: readonly { field: string; column: AnyPgColumn }[];
  fields: readonly ImportField[];
  /** Which vocabularies the fields resolve through. */
  lookupSets: readonly string[];
  schema: Schema;
  /** The namespace this register's field labels live under. */
  namespace: string;
  entityType: string;
  /** Domain validation that needs the tenant-scoped transaction (for example live references). */
  validate?: ImportDomainValidator;
  /** Fields that may be supplied on creates but cannot change an existing row for this caller. */
  restrictedUpdateFields?: readonly string[];
}

/** The file's own limits, checked before any of it is parsed or queried. */
export const MAX_IMPORT_BYTES = 2_000_000;

function exceedsImportByteLimit(text: string): boolean {
  /* This module is server-only. `Buffer.byteLength` measures the UTF-8 payload
     the browser actually posts; `text.length` counts UTF-16 code units and can
     materially under-count Persian input. */
  return Buffer.byteLength(text, "utf8") > MAX_IMPORT_BYTES;
}

async function headings(spec: ImportSpec<z.ZodType>): Promise<Record<string, string>> {
  const t = await getTranslations(spec.namespace);
  return Object.fromEntries(spec.fields.map((field) => [field.key, t(`field.${field.key}`)]));
}

/**
 * The live record keys, without loading complete records into memory.
 *
 * Previewing an import only needs the identity key and id. The apply pass also
 * starts here, then fetches complete rows for the *specific corrections* in the
 * plan. That keeps an import of a few rows from reading every national id, note
 * and other payload in a large register.
 */
async function liveKeys(
  tenantId: string,
  spec: ImportSpec<z.ZodType>,
  candidateKeys: readonly string[],
) {
  const byKey = new Map<string, string>();
  const uniqueKeys = [...new Set(candidateKeys.filter(Boolean))];
  if (uniqueKeys.length === 0) return byKey;

  const identity = spec.identity?.length
    ? spec.identity
    : [{ field: spec.keyField, column: spec.keyColumn }];

  const selection: Record<string, AnyPgColumn> = { id: spec.id };
  identity.forEach((part, index) => {
    selection[`identity${index}`] = part.column;
  });

  let candidatePredicate: SQL | undefined;
  if (identity.length === 1) {
    const firstIdentity = identity[0];
    if (!firstIdentity) throw new Error("import identity is missing");
    candidatePredicate = inArray(firstIdentity.column, uniqueKeys);
  } else {
    const clauses: SQL[] = [];
    for (const key of uniqueKeys) {
      let parts: unknown;
      try {
        parts = JSON.parse(key);
      } catch {
        continue;
      }
      if (!Array.isArray(parts) || parts.length !== identity.length) continue;
      const comparisons = identity.map((part, index) =>
        eq(part.column, String(parts[index] ?? "")),
      );
      const clause = and(...comparisons);
      if (clause) clauses.push(clause);
    }
    candidatePredicate =
      clauses.length === 1 ? clauses[0] : clauses.length > 1 ? or(...clauses) : undefined;
  }

  if (!candidatePredicate) return byKey;
  const rows = (await readOnly(tenantId, (tx) =>
    tx
      .select(selection)
      .from(spec.table)
      .where(and(isNull(spec.deletedAt), candidatePredicate)),
  )) as Record<string, unknown>[];

  for (const row of rows) {
    const id = String(row.id ?? "");
    if (!id) continue;
    const values: Record<string, unknown> = {};
    identity.forEach((part, index) => {
      values[part.field] = row[`identity${index}`];
    });
    const resolved = importIdentityKey(
      spec.fields,
      identity.map((part) => part.field),
      values,
    );
    if (resolved.key) byKey.set(resolved.key, id);
  }
  return byKey;
}

/** Complete base rows only for corrections the plan will actually attempt. */
async function storedCorrections(
  tenantId: string,
  spec: ImportSpec<z.ZodType>,
  ids: readonly string[],
) {
  const byId = new Map<string, Record<string, unknown>>();
  if (ids.length === 0) return byId;

  const rows = (await readOnly(tenantId, (tx) =>
    tx
      .select()
      .from(spec.table)
      .where(and(isNull(spec.deletedAt), inArray(spec.id, [...new Set(ids)]))),
  )) as Record<string, unknown>[];

  for (const row of rows) {
    const id = String(row.id ?? "");
    if (id) byId.set(id, row);
  }
  return byId;
}

/** What this file would do, decided without writing anything. */
export async function planFor<Schema extends z.ZodType>(
  tenantId: string,
  spec: ImportSpec<Schema>,
  text: string,
  includeStoredRows = false,
) {
  /* The browser checks this before File.text(), but a Server Action is a public
     endpoint and can be called without the browser. Refuse before CSV parsing
     or loading the register into memory. */
  if (exceedsImportByteLimit(text)) {
    const words = await getTranslations("importing");
    return {
      labels: {},
      stored: new Map<string, Record<string, unknown>>(),
      plan: {
        creates: [],
        updates: [],
        faults: [{ line: 1, column: "", reason: words("tooLarge"), value: "" }],
        ignored: [],
        totalRows: 0,
        truncated: true,
      },
    };
  }

  const [labels, lookups, words] = await Promise.all([
    headings(spec),
    lookupTable(tenantId, spec.lookupSets),
    getTranslations("importing"),
  ]);
  const vocabularies = {
    get: (set: string) => (lookups.get(set) ?? []).filter((entry) => !entry.retired),
  };
  const identityFields = spec.identity?.length
    ? spec.identity.map((part) => part.field)
    : [spec.keyField];
  const planWith = (existing: Map<string, string>) =>
    planImport({
      text,
      fields: spec.fields,
      labels,
      vocabularies,
      keyField: spec.keyField,
      ...(spec.identity?.length ? { identityFields } : {}),
      existing,
      words: {
        unknownValue: words("unknownValue"),
        missingKey: words("missingKey"),
        duplicateKey: words("duplicateKey"),
        malformedCsv: words("malformedCsv"),
        tooManyRows: words("tooManyRows"),
      },
      limit: IMPORT_LIMIT,
    });

  /* First reuse the real parser/normaliser to discover only the valid identities
     in this file. Querying the database is then O(import rows), not O(register). */
  const provisional = planWith(new Map());
  const candidateKeys = provisional.creates
    .map((row) => importIdentityKey(spec.fields, identityFields, row.values).key)
    .filter(Boolean);
  const existing = await liveKeys(tenantId, spec, candidateKeys);
  const plan = planWith(existing);

  const needsStored = includeStoredRows || Boolean(spec.restrictedUpdateFields?.length);
  const stored = needsStored
    ? await storedCorrections(
        tenantId,
        spec,
        plan.updates.map((row) => row.id),
      )
    : new Map<string, Record<string, unknown>>();

  if (spec.restrictedUpdateFields?.length) {
    const allowed: typeof plan.updates = [];
    for (const row of plan.updates) {
      const before = stored.get(row.id);
      if (!before) {
        allowed.push(row);
        continue;
      }
      let blocked = false;
      for (const key of spec.restrictedUpdateFields) {
        if (!(key in row.values)) continue;
        const field = spec.fields.find((candidate) => candidate.key === key);
        if (!same(field?.kind ?? "text", before[key] ?? null, row.values[key] ?? null)) {
          plan.faults.push({
            line: row.line,
            column: labels[key] ?? key,
            reason: words("forbiddenUpdate"),
            value: row.values[key] ?? "",
          });
          blocked = true;
          break;
        }
      }
      if (!blocked) allowed.push(row);
    }
    plan.updates = allowed;
  }

  return {
    labels,
    stored: includeStoredRows ? stored : new Map<string, Record<string, unknown>>(),
    plan,
  };
}

/** The same file, read again, and written. */
export async function importFor<Schema extends z.ZodType>(
  tenantId: string,
  actorId: string,
  spec: ImportSpec<Schema>,
  text: string,
): Promise<ImportOutcome> {
  const [{ plan, labels, stored }, words, root] = await Promise.all([
    planFor(tenantId, spec, text, true),
    getTranslations("importing"),
    /* Unnamespaced: a validator's message is a path from the root of the
       catalogue — `errors.text.nationalId` — because that is what the form
       resolves it against. */
    getTranslations(),
  ]);

  return applyImport({
    tenantId,
    actorId,
    plan,
    table: spec.table,
    id: spec.id,
    deletedAt: spec.deletedAt,
    version: spec.version,
    schema: spec.schema,
    fields: spec.fields,
    stored,
    entityType: spec.entityType,
    labels,
    /*
     * A validator's message is a catalogue key — `text.nationalId` — because
     * that is what the form resolves. Here there is no field to hang it on, so
     * a key this catalogue knows is worded and anything else falls back to the
     * general sentence rather than printing a fragment of source at somebody.
     */
    refusal: (message) => {
      const path = `errors.${message}`;
      const said = root(path);
      return said.endsWith(path) ? words("refusedByRule") : said;
    },
    ...(spec.validate ? { validate: spec.validate } : {}),
  });
}

/** Reverse a batch only after the caller's domain capability has been checked. */
export async function rollbackFor(
  tenantId: string,
  actorId: string,
  spec: ImportSpec<z.ZodType>,
  batchId: string,
): Promise<RollbackOutcome> {
  return rollbackImport({
    tenantId,
    actorId,
    table: spec.table,
    id: spec.id,
    deletedAt: spec.deletedAt,
    version: spec.version,
    entityType: spec.entityType,
    batchId,
    ...(spec.restrictedUpdateFields ? { restrictedUpdateFields: spec.restrictedUpdateFields } : {}),
  });
}
