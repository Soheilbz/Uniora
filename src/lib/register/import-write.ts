import { randomUUID } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { AnyPgColumn, PgTable } from "drizzle-orm/pg-core";
import type { z } from "zod";
import { auditLog } from "@/db/schema.ts";
import { withTenant } from "@/db/tenant.ts";
import { writeAuditEvent } from "@/lib/audit-writer.ts";
import { same } from "@/lib/register/changes.ts";
import { isRecordVersion } from "@/lib/register/version.ts";
import { isUuid } from "@/lib/uuid.ts";
import { asFormValue, type ImportFault, type ImportPlan } from "./import.ts";
import { rollbackTouchesRestrictedField } from "./import-rollback.ts";

export { rollbackTouchesRestrictedField } from "./import-rollback.ts";

export type ImportDomainValidator = (
  tx: Parameters<Parameters<typeof withTenant>[1]>[0],
  values: Record<string, unknown>,
  before?: Record<string, unknown>,
) => Promise<Record<string, string>>;

/**
 * Applying a plan the reader has already seen.
 *
 * ── One validator, not two ──────────────────────────────────────────────────
 *
 * Every row goes through the *same* schema a typed record does. That is the
 * whole discipline of this file: an import that validated more loosely than the
 * form would be a way to put records into the register that the register's own
 * edit screen then refuses to save — which is exactly what happened to twenty-
 * four of twenty-six seeded students, whose national ids the form rejected the
 * moment anybody opened them.
 *
 * So a row the schema refuses becomes a fault, in the same list as the faults
 * the plan found, and the reader sees one list rather than two rounds of them.
 *
 * ── A correction sets what the file names, and nothing else ─────────────────
 *
 * A spreadsheet an office edits usually carries a few columns, not fifty.
 * Writing every field of the schema would blank everything the file left out —
 * so an update writes only the keys the row actually carried, and the plan has
 * already dropped the empty cells.
 */

export interface ImportOutcome {
  /** Opaque batch id, used only to offer a safe, auditable rollback. */
  batchId: string;
  created: number;
  updated: number;
  faults: ImportFault[];
  ignored: string[];
  /** Rows read, so a capped file can say so. */
  read: number;
}

export async function applyImport<Schema extends z.ZodType>({
  tenantId,
  actorId,
  plan,
  table,
  id,
  deletedAt,
  version,
  schema,
  fields,
  stored,
  entityType,
  labels,
  refusal,
  validate,
}: {
  tenantId: string;
  actorId: string;
  plan: ImportPlan;
  table: PgTable;
  id: AnyPgColumn;
  deletedAt: AnyPgColumn;
  /** The optimistic-concurrency column, matched against what was read. */
  version: AnyPgColumn;
  /** The register's own validator — the one its form uses. */
  schema: Schema;
  /** Every field the register has, so a row can be padded the way a form posts. */
  fields: readonly { key: string; kind?: string }[];
  /**
   * The records the corrections are against, by id.
   *
   * A correction is checked as the record *would be* after it — the file's
   * columns over the ones already on file — so an office fixing two telephone
   * numbers does not have to re-supply the student's standing and surname just
   * to satisfy the required-field rule.
   */
  stored: Map<string, Record<string, unknown>>;
  entityType: string;
  /** `key` → the heading, so a refusal names the column the office sees. */
  labels: Record<string, string>;
  /** How a schema refusal is worded when the rule has no message of its own. */
  refusal: (message: string) => string;
  /** Optional domain checks that need the tenant-scoped database snapshot (references, cross-field rules). */
  validate?: ImportDomainValidator;
}): Promise<ImportOutcome> {
  const faults: ImportFault[] = [...plan.faults];
  const batchId = randomUUID();
  let created = 0;
  let updated = 0;

  /* A capped plan is information only. Writing its first N rows would turn an
     explicit safety limit into a partial data migration. */
  if (plan.truncated) {
    return {
      batchId,
      created: 0,
      updated: 0,
      faults,
      ignored: plan.ignored,
      read: plan.creates.length + plan.updates.length + plan.faults.length,
    };
  }

  /**
   * A row through the register's own rules, or the reasons it was refused.
   *
   * Padded with an empty string for every field the file did not carry, because
   * that is exactly what a *form* posts: an untouched box arrives as `""`, and
   * the validator turns it back into «not recorded». Handed only the columns the
   * file had, every absent field fails on `z.string()` receiving `undefined` —
   * so a four-column spreadsheet was refused with fifty faults per row, one for
   * each field it did not mention.
   *
   * The padding is only for the *check*. What gets written is still only the
   * keys the row actually carried; see the update below.
   */
  const check = (
    line: number,
    values: Record<string, string>,
    base: Record<string, unknown> = {},
  ) => {
    const padded: Record<string, string> = {};
    for (const field of fields) {
      padded[field.key] = values[field.key] ?? asFormValue(base[field.key], field.kind);
    }
    const parsed = schema.safeParse(padded);
    if (parsed.success) return parsed.data as Record<string, unknown>;

    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? "");
      faults.push({
        line,
        column: labels[key] ?? key,
        reason: refusal(issue.message),
        value: values[key] ?? "",
      });
    }
    return null;
  };

  await withTenant(tenantId, async (tx) => {
    const domainFaults = async (
      line: number,
      values: Record<string, unknown>,
      submitted: Record<string, string>,
      before?: Record<string, unknown>,
    ) => {
      if (!validate) return false;
      const errors = await validate(tx, values, before);
      for (const [key, message] of Object.entries(errors)) {
        faults.push({
          line,
          column: labels[key] ?? key,
          reason: refusal(message),
          value: submitted[key] ?? "",
        });
      }
      return Object.keys(errors).length > 0;
    };

    for (const row of plan.creates) {
      /*
       * A create is validated against the *whole* schema, so a required field
       * the file omitted is refused here — a new record with no surname is not
       * a record.
       */
      const data = check(row.line, row.values);
      if (!data) continue;
      if (await domainFaults(row.line, data, row.values)) continue;

      const [written] = await tx
        .insert(table)
        .values({ ...data, tenantId })
        .returning({ id, version });
      if (!written) continue;

      await writeAuditEvent(tx, {
        tenantId,
        actorId,
        action: "create",
        entityType,
        entityId: String(written.id),
        /* The trail says the record arrived in an import, because «who created
           this student» has a different answer when the answer is a file. */
        changes: JSON.stringify({
          batchId,
          version: { from: null, to: written.version },
          import: { from: null, to: `line ${row.line}` },
        }),
      });
      created += 1;
    }

    for (const row of plan.updates) {
      /*
       * A correction is checked the same way — every rule the form applies —
       * and then writes only what the file named.
       *
       * Missing columns are filled from the stored row for validation, then only
       * the columns the file actually carried are written. This lets a focused
       * correction (for example, one telephone number) satisfy the same whole-
       * record rules as the interactive form without erasing fields the file did
       * not mention.
       */
      const base = stored.get(row.id) ?? {};
      const data = check(row.line, row.values, base);
      if (!data) continue;
      if (await domainFaults(row.line, data, row.values, base)) continue;

      /* Only the keys the row carried, so an absent column is «not mentioned»
         rather than «set to nothing». */
      const patch: Record<string, unknown> = {};
      for (const key of Object.keys(row.values)) {
        const field = fields.find((candidate) => candidate.key === key);
        const next = data[key];
        if (!same(field?.kind ?? "text", base[key] ?? null, next ?? null)) patch[key] = next;
      }
      if (Object.keys(patch).length === 0) continue;

      /*
       * The version the plan read the record at, matched on write.
       *
       * An import is a write to records nobody is looking at, which is exactly
       * so a clerk's concurrent edit cannot vanish: an import never overwrites it
       * without a conflict and the audit entry named no fields. Now the update
       * matches the version the read saw — the same guard an interactive save
       * uses. A record changed in between does not come back from `.returning`
       * and is reported as a fault, so the office knows which lines to re-run.
       */
      const expectedVersion = Number(base.version);
      if (!isRecordVersion(expectedVersion)) {
        faults.push({
          line: row.line,
          column: "",
          reason: refusal("record.conflict"),
          value: "",
        });
        continue;
      }

      const [written] = await tx
        .update(table)
        .set({ ...patch, updatedAt: sql`now()`, version: expectedVersion + 1 })
        .where(and(eq(id, row.id), eq(version, expectedVersion), isNull(deletedAt)))
        .returning({ id });
      if (!written) {
        faults.push({
          line: row.line,
          column: "",
          reason: refusal("record.conflict"),
          value: "",
        });
        continue;
      }

      /* Field-level diffs, like every other write — plus the provenance line,
         because «who created this change» has a different answer when the
         answer is a file. */
      const changes: Record<string, unknown> = {};
      for (const key of Object.keys(patch)) {
        changes[key] = { from: base[key] ?? null, to: patch[key] };
      }
      changes.batchId = batchId;
      changes.version = { from: expectedVersion, to: expectedVersion + 1 };
      changes.import = { from: null, to: `line ${row.line}` };

      await writeAuditEvent(tx, {
        tenantId,
        actorId,
        action: "update",
        entityType,
        entityId: String(written.id),
        changes: JSON.stringify(changes),
      });
      updated += 1;
    }
  });

  return {
    batchId,
    created,
    updated,
    faults,
    ignored: plan.ignored,
    read: plan.creates.length + plan.updates.length + plan.faults.length,
  };
}

export interface RollbackOutcome {
  rolledBack: number;
  /** Rows deliberately left untouched because they changed after the import or the audit entry was unusable. */
  skipped: number;
}

/**
 * Reverse one import batch, conservatively and audibly.
 *
 * Created rows are retired; corrected rows receive the field values that were
 * present before the import. Every row is checked as it is reversed, so a
 * later edit is never silently overwritten by a rollback from an old file.
 */
export async function rollbackImport({
  tenantId,
  actorId,
  table,
  id,
  deletedAt,
  version,
  entityType,
  batchId,
  restrictedUpdateFields = [],
}: {
  tenantId: string;
  actorId: string;
  table: PgTable;
  id: AnyPgColumn;
  deletedAt: AnyPgColumn;
  version: AnyPgColumn;
  entityType: string;
  batchId: string;
  /** Fields this caller is not allowed to change on an existing record, including through rollback. */
  restrictedUpdateFields?: readonly string[];
}): Promise<RollbackOutcome> {
  if (!isUuid(batchId)) return { rolledBack: 0, skipped: 0 };

  return withTenant(tenantId, async (tx) => {
    const entries = await tx
      .select({
        id: auditLog.id,
        entityId: auditLog.entityId,
        action: auditLog.action,
        changes: auditLog.changes,
      })
      .from(auditLog)
      .where(
        and(
          eq(auditLog.entityType, entityType),
          sql`${auditLog.changes} like ${`%"batchId":"${batchId}"%`}`,
        ),
      );
    let rolledBack = 0;
    let skipped = 0;

    for (const entry of entries) {
      if (!entry.entityId || !entry.changes) {
        skipped += 1;
        continue;
      }
      let changes: Record<string, unknown>;
      try {
        changes = JSON.parse(entry.changes) as Record<string, unknown>;
      } catch {
        skipped += 1;
        continue;
      }
      if (changes.batchId !== batchId) {
        skipped += 1;
        continue;
      }

      const versionChange = changes.version;
      const expectedVersion =
        versionChange && typeof versionChange === "object" && "to" in versionChange
          ? Number((versionChange as { to: unknown }).to)
          : Number.NaN;
      if (!isRecordVersion(expectedVersion)) {
        skipped += 1;
        continue;
      }

      if (entry.action === "create") {
        const retired = await tx
          .update(table)
          .set({ deletedAt: sql`now()`, updatedAt: sql`now()`, version: sql`${version} + 1` })
          .where(and(eq(id, entry.entityId), eq(version, expectedVersion), isNull(deletedAt)))
          .returning({ id });
        if (retired.length === 0) {
          skipped += 1;
          continue;
        }
      } else if (entry.action === "update") {
        const restore: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(changes)) {
          if (key === "batchId" || key === "import" || key === "version") continue;
          if (!value || typeof value !== "object" || !("from" in value)) continue;
          restore[key] = (value as { from: unknown }).from;
        }
        if (rollbackTouchesRestrictedField(restore, restrictedUpdateFields)) {
          skipped += 1;
          continue;
        }
        if (Object.keys(restore).length === 0) {
          skipped += 1;
          continue;
        }
        const restored = await tx
          .update(table)
          .set({ ...restore, updatedAt: sql`now()`, version: sql`${version} + 1` })
          .where(and(eq(id, entry.entityId), eq(version, expectedVersion), isNull(deletedAt)))
          .returning({ id });
        if (restored.length === 0) {
          skipped += 1;
          continue;
        }
      } else {
        skipped += 1;
        continue;
      }

      await writeAuditEvent(tx, {
        tenantId,
        actorId,
        action: "update",
        entityType,
        entityId: entry.entityId,
        changes: JSON.stringify({ rollbackOf: entry.id, batchId }),
      });
      rolledBack += 1;
    }

    return { rolledBack, skipped };
  });
}
