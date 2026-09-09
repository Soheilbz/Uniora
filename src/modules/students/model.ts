/**
 * What the register is, described without reference to how it is read.
 *
 * No drizzle, no schema, no database — deliberately, and it is a hard rule
 * rather than a preference. `params.ts` builds the register's URLs and is
 * imported by the toolbar, which is a client component; anything this file
 * touched would be pulled into the browser bundle along with it. Importing the
 * table definitions here would ship the entire schema — every column of every
 * table in the system — to every person who opens the register.
 *
 * So the shape of the register lives here, and `register.ts` is the only file
 * that turns it into SQL.
 */

import type { FilterDef, RegisterSpec } from "@/lib/register/spec.ts";

/**
 * The filters the student register offers, and what narrows what.
 */
export const FILTERS = [
  { key: "degree", set: "degrees", narrowedBy: null },
  { key: "status", set: "student_statuses", narrowedBy: null },
  { key: "faculty", set: "faculties", narrowedBy: null },
  { key: "department", set: "departments", narrowedBy: "faculty" },
  { key: "field", set: "fields_of_study", narrowedBy: "department" },
  { key: "gender", set: "genders", narrowedBy: null },
] as const satisfies readonly FilterDef[];

export type FilterKey = (typeof FILTERS)[number]["key"];

/**
 * What the table's columns sort by.
 *
 * `name` and `placement` are composites that sort by the fields they actually
 * display. `supervisors` and `advisor` are deliberately absent: they show names
 * resolved through a foreign key, and ordering a register by an opaque uuid is
 * an order with no meaning on screen — so those columns are not offered as
 * sortable rather than offered and quietly wrong.
 */
export const SORTABLE = ["studentNumber", "name", "degree", "status", "placement"] as const;
export type SortKey = (typeof SORTABLE)[number];

export const STUDENT_REGISTER: RegisterSpec = {
  basePath: "/students",
  filters: FILTERS,
  sortable: SORTABLE,
  defaultSort: "name",
};

/** The vocabularies this screen needs, for one `lookupTable` call. */
export const REGISTER_LOOKUP_SETS: readonly string[] = [
  ...new Set(FILTERS.map((filter) => filter.set)),
];

export interface RegisterRow {
  id: string;
  studentNumber: string;
  nationalId: string | null;
  firstName: string;
  lastName: string;
  gender: string | null;
  degree: string | null;
  status: string;
  faculty: string | null;
  department: string | null;
  fieldOfStudy: string | null;
  primarySupervisor: string | null;
  secondarySupervisor: string | null;
  advisor: string | null;
  /** The optimistic-concurrency version, read with the row. */
  version: number;
}

/**
 * The fields a bulk edit may set on a student.
 *
 * Standing and degree, and nothing else. Both are vocabulary values where «set
 * the same one across this selection» is a thing an office actually does — a
 * cohort graduates, an intake is re-classified. A name, a national id or a
 * thesis title is never that, and offering them would turn a mis-click into a
 * data loss nobody can see afterwards.
 *
 * Enforced in the Server Action against this list, not by the dialog that
 * renders it: the action is a public endpoint.
 */
export const BULK_EDITABLE: readonly string[] = ["status", "degree"];
