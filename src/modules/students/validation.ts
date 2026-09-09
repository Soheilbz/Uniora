import { schemaFor } from "@/lib/register/validation.ts";
import { STUDENT_FIELDS } from "./fields.ts";

/**
 * The student record's rules.
 *
 * The rules themselves live in `lib/register/validation.ts` — they are about
 * field *kinds* and are the same for every register. This file is the binding:
 * these fields, checked by those rules.
 */
export const studentSchema = schemaFor(STUDENT_FIELDS);

export { foldDigits } from "@/lib/digits.ts";
export { isValidNationalId } from "@/lib/register/validation.ts";
