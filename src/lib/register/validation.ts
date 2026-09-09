import { z } from "zod";
import { foldDigits } from "@/lib/digits.ts";
import type { AnyFieldSpec as FieldSpec } from "@/lib/register/field-spec.ts";

/**
 * What a record has to satisfy before it is written.
 *
 * Built from a field list rather than typed out, so a field added to the form is
 * validated by construction. The alternative is a schema maintained beside the
 * field list, and the way that fails is specific: somebody adds a field, adds it
 * to the form, forgets the validator, and the new field is the one field on the
 * record that accepts anything.
 *
 * Shared by the student register and the council's three, because the rules are
 * about *field kinds* — a digits-only box, a GPA, an ISO date — and those do not
 * differ between registers. What differs is which fields exist, and that is the
 * argument.
 *
 * This runs on the server, inside the Server Action. The form uses the same
 * rules to show errors as somebody types, but that is a courtesy — the check
 * that matters is this one, because a Server Action is a public endpoint and
 * "the form would not have let me" is not a constraint on anybody sending it a
 * request directly.
 */

/**
 * Letters that are the same letter, written the same way.
 *
 * `app.fold_text` does this in SQL for *searching*, where the folded form is
 * thrown away afterwards. This is the other half: a name being **stored** — a
 * council seat, an attendance list — normalised so that the record itself is
 * spelled one way. An Arabic yeh typed into the roster produces «موسوي», which
 * never lines up with the directory's «موسوی», and every attendance list seeded
 * from that roster inherits the spelling.
 *
 * Only the letters that are genuinely one letter in Persian. Nothing is
 * lowercased, nothing is stripped, and the zero-width non-joiner is left
 * exactly where it was — it is what makes «پایان‌نامه» one word.
 */
const SAME_LETTER: Record<string, string> = {
  ي: "ی",
  ۍ: "ی",
  ئ: "ی",
  ې: "ی",
  ك: "ک",
  ڪ: "ک",
  ٱ: "ا",
  ة: "ه",
  ۀ: "ه",
};

export function normalizePersianLetters(input: string): string {
  return input.replace(/[يۍئېكڪٱةۀ]/g, (letter) => SAME_LETTER[letter] ?? letter);
}

/**
 * The Iranian national identity number's check digit.
 *
 * Ten digits, where the last is determined by the first nine: each is weighted
 * by its distance from the end, the sum is taken modulo 11, and the remainder
 * gives the check digit (below 2 it is the remainder itself, otherwise 11 minus
 * it). All-same-digit strings pass that arithmetic and are not real numbers, so
 * they are refused separately.
 *
 * Worth checking because the office relies on it: a national id is how a student
 * is matched against ministry records, and a transposed pair of digits produces
 * a number that looks right, files cleanly, and fails months later in somebody
 * else's system.
 */
export function isValidNationalId(input: string): boolean {
  const digits = foldDigits(input).trim();
  if (!/^\d{10}$/.test(digits)) return false;
  // «0000000000», «1111111111» and the rest satisfy the checksum by accident.
  if (/^(\d)\1{9}$/.test(digits)) return false;

  const check = Number(digits[9]);
  let sum = 0;
  for (let position = 0; position < 9; position += 1) {
    sum += Number(digits[position]) * (10 - position);
  }
  const remainder = sum % 11;
  return remainder < 2 ? check === remainder : check === 11 - remainder;
}

/**
 * An empty box means "not recorded", and that is `null` rather than `""`.
 *
 * A form posts every field it has, so an untouched box arrives as an empty
 * string. Stored as one, the register then holds a student whose father's name
 * is the empty string — which is not the same as unrecorded: it sorts
 * differently, it is not caught by `IS NULL`, and a report counting recorded
 * values counts it.
 */
const blankToNull = z
  .string()
  .transform((value) => value.trim())
  .transform((value) => (value === "" ? null : value));

export function isValidIsoDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= (days[month - 1] ?? 0);
}

function ruleFor(field: FieldSpec): z.ZodTypeAny {
  switch (field.kind) {
    case "boolean":
      /*
       * A checkbox posts nothing when it is not ticked. `z.coerce.boolean()` is
       * not suitable for an endpoint boundary because JavaScript considers the
       * string "false" truthy; a crafted request could therefore invert what it
       * says. Accept only the representations an HTML form/client may emit.
       */
      return z.preprocess((value) => {
        if (value === undefined || value === null || value === "" || value === false) return false;
        if (value === true || value === "on" || value === "true" || value === "1") return true;
        if (value === "false" || value === "0") return false;
        return value;
      }, z.boolean());

    case "number": {
      const { min, max, scale } = field;
      return z
        .string()
        .transform((value) => {
          const folded = foldDigits(value).trim();
          return folded === "" ? null : folded;
        })
        .superRefine((value, ctx) => {
          if (value === null) return;
          if (!/^-?\d+(\.\d+)?$/.test(value)) {
            ctx.addIssue({ code: "custom", message: "number.invalid" });
            return;
          }
          const parsed = Number(value);
          if (!Number.isFinite(parsed)) {
            ctx.addIssue({ code: "custom", message: "number.invalid" });
            return;
          }
          const fractionalPlaces = value.includes(".") ? (value.split(".")[1]?.length ?? 0) : 0;
          if (scale !== undefined && fractionalPlaces > scale) {
            ctx.addIssue({ code: "custom", message: "number.scale" });
          }
          if ((min !== undefined && parsed < min) || (max !== undefined && parsed > max)) {
            ctx.addIssue({ code: "custom", message: "number.range" });
          }
        })
        .transform((value) => (value === null ? null : Number(value)));
    }

    case "date":
      /*
       * An ISO date, because that is what the browser's date control produces
       * and what PostgreSQL's `date` accepts. The *display* is Jalali — that
       * conversion belongs at the edges, and doing it here would mean the
       * database held a calendar its own SQL could not compare or sort.
       */
      return blankToNull.refine((value) => value === null || isValidIsoDate(value), "date.invalid");

    case "choice": {
      /*
       * Checked here in full, unlike a lookup — the list is in the code, so
       * this module already has it and needs nothing from the database. That
       * is the whole point of the kind: something branches on these values, so
       * an unknown one must not reach the column at all.
       */
      const allowed = field.choices ?? [];
      return blankToNull.refine(
        (value) => value === null || allowed.some((choice) => choice.value === value),
        "choice.unknown",
      );
    }

    case "lookup":
      /*
       * Shape only. Lookup values are suggestions and may be new; whether a
       * reference id names a professor in *this* tenant is a database question
       * handled by the action. Normalize the handful of Persian letter forms
       * that otherwise create two visually identical values.
       */
      return blankToNull.transform((value) =>
        value === null ? null : normalizePersianLetters(value),
      );

    case "reference":
      /*
       * Reference columns are UUIDs. Reject malformed identifiers before a
       * tenant lookup reaches PostgreSQL; otherwise an invalid UUID becomes a
       * database cast error and a 500 instead of a field validation error.
       */
      return blankToNull.refine(
        (value) =>
          value === null ||
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value),
        "reference.unknown",
      );

    default: {
      /*
       * One chain, rather than a rule reassigned through several `.refine()`
       * calls. The progressive version does not typecheck — each pipe wraps the
       * last in a new type — and reading it, the order in which the folds and
       * the checks applied was genuinely hard to follow. Fold first, then check
       * what was folded.
       */
      const { format, maxLength } = field;
      const numeric =
        format === "digits" ||
        format === "nationalId" ||
        format === "tel" ||
        format === "sittingNumber" ||
        format === "time" ||
        format === "clockText";

      return z
        .string()
        .transform((value) => {
          const trimmed = value.trim();
          if (trimmed === "") return null;
          return numeric ? foldDigits(trimmed) : trimmed;
        })
        .superRefine((value, ctx) => {
          if (value === null) return;
          const fail = (message: string) => ctx.addIssue({ code: "custom", message });

          if (maxLength !== undefined && value.length > maxLength) fail("text.tooLong");
          if (format === "digits" && !/^\d+$/.test(value)) fail("text.digitsOnly");
          if (format === "time" && !/^(?:[01]?\d|2[0-3]):[0-5]\d$/.test(value)) fail("text.time");
          if (format === "nationalId" && !isValidNationalId(value)) fail("text.nationalId");
          // Deliberately permissive: the strict rule rejects addresses that
          // work, and this column is a way to reach somebody rather than a
          // credential.
          if (format === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) fail("text.email");
          if (format === "tel" && !/^[\d\s+()-]+$/.test(value)) fail("text.tel");
        });
    }
  }
}

/**
 * A register's rules, one per field.
 *
 * `group` is deliberately not in the parameter type: the council's groups are
 * its own and this function has no interest in them. It reads the kind, the
 * format and the bounds, which every field list shares.
 */
export function schemaFor(fields: readonly Omit<FieldSpec, "group">[]) {
  return z.object(
    Object.fromEntries(
      fields.map((field) => {
        const rule = ruleFor(field as FieldSpec);
        return [
          field.key,
          field.required
            ? rule.refine((value) => value !== null && value !== "", "required")
            : rule,
        ];
      }),
    ),
  );
}
