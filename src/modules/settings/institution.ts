"use server";

import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { institutions } from "@/db/schema.ts";
import { withTenant } from "@/db/tenant.ts";
import { writeAuditEvent } from "@/lib/audit-writer.ts";
import { hasDatabaseErrorCode } from "@/lib/db-errors.ts";
import type { ActionResult } from "@/lib/register/action-result.ts";
import { isRecordVersion } from "@/lib/register/version.ts";
import { requireElevatedSession } from "@/lib/step-up.ts";
import { requireCapability } from "@/lib/viewer.ts";
import { currentTenantAuthority } from "./current-authority.ts";

export type { InstitutionView } from "./institution-queries.ts";

/**
 * The institution as it appears on paper.
 *
 * Every printed instrument this application produces carries the letterhead:
 * the worksheets, and the minutes and certificates that follow. A wrong one is
 * not a cosmetic defect — it is a form signed and filed under somebody else's
 * name — which is why this is behind a capability of its own rather than the
 * one that maintains reference lists.
 */

/**
 * The profile, or a blank one.
 *
 * A blank rather than null, because "this institution has never filled the form
 * in" and "this institution is called nothing" are the same state to every
 * consumer, and a nullable record would make each of them handle it. What no
 * consumer may do is invent a name — see `readLetterhead`, which reports
 * `named: false` and prints nothing.
 */
/** What a crest may be, and how big. */
const CREST_TYPES = ["image/png", "image/jpeg"] as const;
const CREST_LIMIT = 200 * 1024;

/**
 * Sniffs the bytes rather than trusting the declared type.
 *
 * The type a browser reports is whatever the uploading page said it was; the
 * bytes are what will actually be served. PNG starts with its eight-byte
 * signature and JPEG with an FF D8 FF marker — three comparisons that remove an
 * entire class of "the file says it is a picture" uploads, which matters here
 * because the crest is stored verbatim and rendered on every printed document
 * this institution produces.
 *
 * SVG is intentionally rejected because it is XML-capable active content and
 * creates unnecessary rendering risk for an asset reproduced on official
 * documents. Letterhead uploads are restricted to byte-verified PNG/JPEG.
 */
function sniffImageType(bytes: Buffer): (typeof CREST_TYPES)[number] | null {
  if (
    bytes.length > 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return "image/png";
  }
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  return null;
}

const TEXT_FIELDS = ["name", "nameEn", "faculty", "address", "phone", "email", "website"] as const;
const SUPPORTED_LOCALES = new Set(["fa", "en"]);
const SUPPORTED_CALENDARS = new Set(["jalali", "gregorian"]);

export async function saveInstitution(
  _previous: ActionResult | null,
  form: FormData,
): Promise<ActionResult> {
  const viewer = await requireCapability("institution.manage");
  await requireElevatedSession(viewer, "/settings/institution");

  const submitted = Object.fromEntries(
    TEXT_FIELDS.map((field) => [field, String(form.get(field) ?? "").trim()]),
  ) as Record<(typeof TEXT_FIELDS)[number], string>;

  const timezone = String(form.get("timezone") ?? "").trim();
  const locale = String(form.get("locale") ?? "fa").trim();
  const calendarSystem = String(form.get("calendarSystem") ?? "jalali").trim();
  /* Tenant MFA is intentionally disabled. Platform operator MFA is a separate
     tenantless security boundary and is not configurable from this screen. */
  const requireAdminMfa = false;
  const sessionHours = Number(form.get("sessionHours") ?? "8");
  const passwordMinLength = Number(form.get("passwordMinLength") ?? "12");
  const operational = {
    timezone,
    locale,
    calendarSystem,
    requireAdminMfa,
    sessionHours,
    passwordMinLength,
  };
  const submittedValues: Record<string, string> = {
    ...submitted,
    timezone,
    locale,
    calendarSystem,
    requireAdminMfa: requireAdminMfa ? "1" : "",
    sessionHours: String(sessionHours),
    passwordMinLength: String(passwordMinLength),
  };

  const errors: Record<string, string> = {};
  for (const field of TEXT_FIELDS) {
    if (submitted[field].length > 300) errors[field] = "tooLong";
  }
  if (submitted.name === "") errors.name = "required";
  if (submitted.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(submitted.email))
    errors.email = "invalidEmail";
  if (submitted.website) {
    try {
      const url = new URL(submitted.website);
      if (!["https:", "http:"].includes(url.protocol)) errors.website = "invalidUrl";
    } catch {
      errors.website = "invalidUrl";
    }
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format();
  } catch {
    errors.timezone = "invalidTimezone";
  }
  if (!SUPPORTED_LOCALES.has(locale)) errors.locale = "invalidOption";
  if (!SUPPORTED_CALENDARS.has(calendarSystem)) errors.calendarSystem = "invalidOption";
  if (!Number.isInteger(sessionHours) || sessionHours < 1 || sessionHours > 24)
    errors.sessionHours = "invalidNumber";
  if (!Number.isInteger(passwordMinLength) || passwordMinLength < 12 || passwordMinLength > 64)
    errors.passwordMinLength = "invalidNumber";
  if (Object.keys(errors).length > 0) return { ok: false, errors, values: submittedValues };

  /*
   * The crest arrives as a file and is stored as a data URI.
   *
   * Read here rather than in the browser: a data URI assembled client-side is a
   * string this endpoint would have to validate anyway — its declared type, its
   * length, whether it is a data URI at all — and validating a string somebody
   * else built is strictly harder than building it from bytes.
   */
  const upload = form.get("crest");
  let crest: string | undefined;

  if (upload instanceof File && upload.size > 0) {
    if (upload.size > CREST_LIMIT) {
      return { ok: false, errors: { crest: "crestTooLarge" }, values: submittedValues };
    }
    const bytes = Buffer.from(await upload.arrayBuffer());
    /* The bytes decide, not the declared type — and SVG is not offered. */
    const type = sniffImageType(bytes);
    if (!type) {
      return { ok: false, errors: { crest: "crestWrongType" }, values: submittedValues };
    }
    crest = `data:${type};base64,${bytes.toString("base64")}`;
  } else if (String(form.get("removeCrest") ?? "") === "1") {
    crest = "";
  }

  const version = Number(form.get("version") ?? "0");
  if (!isRecordVersion(version)) return { ok: false, message: "conflict", values: submittedValues };

  let conflict = false;
  try {
    conflict = await withTenant(viewer.tenantId, async (tx) => {
      const current = await currentTenantAuthority(tx, viewer.tenantId, viewer.userId, [
        "institution.manage",
      ]);
      if (!current) return true;
      const [held] = await tx
        .select()
        .from(institutions)
        .where(eq(institutions.tenantId, viewer.tenantId))
        .limit(1);

      if (!held) {
        /* A first save starts at version zero. Accepting an arbitrary posted
           version here would let a stale/manipulated form bypass the same
           optimistic-lock contract every subsequent edit follows. */
        if (version !== 0) return true;
        const hasInitialContent =
          TEXT_FIELDS.some((field) => submitted[field] !== "") || Boolean(crest);
        if (!hasInitialContent) return false;
        await tx.insert(institutions).values({
          tenantId: viewer.tenantId,
          ...submitted,
          ...operational,
          crest: crest ?? "",
          version: 1,
        });

        const changes: Record<string, { from: unknown; to: unknown }> = {};
        for (const field of TEXT_FIELDS) {
          if (submitted[field] !== "") changes[field] = { from: null, to: submitted[field] };
        }
        /* Operational policy is data too. On the first profile save these
           values are persisted in the same INSERT, so omitting them from the
           audit record would make the initial security/timezone policy
           impossible to reconstruct from the log. */
        for (const [field, value] of Object.entries(operational)) {
          changes[field] = { from: null, to: value };
        }
        if (crest) changes.crest = { from: null, to: "…" };
        if (Object.keys(changes).length > 0) {
          await writeAuditEvent(tx, {
            tenantId: viewer.tenantId,
            actorId: viewer.userId,
            action: "settings.institution.update",
            entityType: "institution",
            entityId: viewer.tenantId,
            changes: JSON.stringify(changes),
          });
        }
        return false;
      }

      if (held.version !== version) return true;

      /* Work out whether the form changes anything before issuing UPDATE. A
         no-op save must not advance the optimistic-lock version or manufacture
         a state change that no audit entry can explain. */
      const changes: Record<string, { from: unknown; to: unknown }> = {};
      for (const field of TEXT_FIELDS) {
        if (held[field] !== submitted[field]) {
          changes[field] = { from: held[field] ?? "", to: submitted[field] };
        }
      }
      for (const [field, value] of Object.entries(operational)) {
        const previous = held[field as keyof typeof held];
        if (previous !== value) changes[field] = { from: previous, to: value };
      }
      if (crest !== undefined && crest !== (held.crest ?? "")) {
        changes.crest = {
          from: (held.crest ?? "") === "" ? null : "…",
          to: crest === "" ? null : "…",
        };
      }
      if (Object.keys(changes).length === 0) return false;

      const updated = await tx
        .update(institutions)
        .set({
          ...submitted,
          ...operational,
          ...(crest === undefined ? {} : { crest }),
          version: version + 1,
          updatedAt: sql`now()`,
        })
        .where(and(eq(institutions.tenantId, viewer.tenantId), eq(institutions.version, version)))
        .returning({ id: institutions.id });
      if (updated.length === 0) return true;

      await writeAuditEvent(tx, {
        tenantId: viewer.tenantId,
        actorId: viewer.userId,
        action: "settings.institution.update",
        entityType: "institution",
        entityId: viewer.tenantId,
        changes: JSON.stringify(changes),
      });
      return false;
    });
  } catch (cause) {
    /* Two first-time saves can both observe "no institution row". The tenant
       key is unique, so the loser is an ordinary optimistic conflict rather
       than an internal error. */
    if (hasDatabaseErrorCode(cause, "23505")) conflict = true;
    else throw cause;
  }

  if (conflict) return { ok: false, message: "conflict", values: submittedValues };

  /*
   * Every page, not this one.
   *
   * The letterhead is printed by the worksheets and will be printed by the
   * minutes and the certificates. A save that refreshed only the settings
   * screen would leave a stale crest on a form somebody prints in the next
   * minute.
   */
  revalidatePath("/", "layout");
  return { ok: true, message: "saved" };
}
