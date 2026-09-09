import type { FilterDef, RegisterSpec } from "@/lib/register/spec.ts";

/**
 * What the professor register is, described without reference to how it is read.
 *
 * No drizzle, no schema, no database — the same hard rule the student register
 * follows. `params.ts` builds this register's URLs and is imported by the
 * toolbar, which is a client component; anything this file touched would be
 * pulled into the browser bundle with it, and importing the table definitions
 * would ship every column of every table in the system to every reader.
 */

/**
 * The filters the register offers.
 *
 * `isFacultyMember` is deliberately not among them, though it is the column the
 * office narrows by most often. Its list is defined in code, and the filter
 * strip is built out of vocabularies — a filter with no vocabulary behind it
 * would be the one control on the strip that worked differently. It is a column
 * on the table instead, where it is visible on every row at once.
 */
export const FILTERS = [
  /*
   * The six the personnel screen offers, in its order — standing first, because
   * «who is actually at their post» is the question a directory of two hundred
   * is narrowed by before any other.
   *
   * No gender filter, and the register has none either: a
   * directory is searched by name, department and standing, and offering to
   * narrow a staff list by sex is a control with no administrative use behind
   * it. The marker beside each name stays — it is there so the office knows how
   * to address somebody in writing, which is a different job.
   */
  { key: "status", set: "professor_statuses", narrowedBy: null },
  { key: "rank", set: "academic_ranks", narrowedBy: null },
  { key: "university", set: "universities", narrowedBy: null },
  { key: "faculty", set: "faculties", narrowedBy: null },
  { key: "department", set: "departments", narrowedBy: "faculty" },
  /*
   * Free text on the record, so there is no reference list to offer — the
   * choices are read from the column itself. It narrows the same way, which is
   * what already keeps the list short enough to pick from.
   */
  { key: "specialization", set: null, narrowedBy: null },
] as const satisfies readonly FilterDef[];

export type FilterKey = (typeof FILTERS)[number]["key"];

/**
 * What the table's columns sort by.
 *
 * `affiliation` is a composite that sorts by the faculty then the department it
 * displays. `students` — the supervision load — is deliberately absent: it is a
 * count computed per row, and offering it as a sort would mean a register whose
 * order depends on a subquery over the whole student table on every page.
 */
export const SORTABLE = ["professorCode", "name", "rank", "affiliation", "department"] as const;
export type SortKey = (typeof SORTABLE)[number];

export const PROFESSOR_REGISTER: RegisterSpec = {
  basePath: "/professors",
  filters: FILTERS,
  sortable: SORTABLE,
  defaultSort: "name",
};

/** The vocabularies this screen needs, for one `lookupTable` call. */
export const REGISTER_LOOKUP_SETS: readonly string[] = [
  ...new Set(FILTERS.map((filter) => filter.set).filter((set) => set !== null)),
];

export interface ProfessorRow {
  id: string;
  professorCode: string | null;
  nationalId: string | null;
  firstName: string;
  lastName: string;
  academicRank: string | null;
  gender: string | null;
  isFacultyMember: string | null;
  university: string | null;
  faculty: string | null;
  department: string | null;
  email: string | null;
  phone: string | null;
  /** The optimistic-concurrency version, read with the row. */
  version: number;
}

/**
 * The fields a bulk edit may set on a professor.
 *
 * Standing and academic rank. Both are things an office sets across a
 * selection — a cohort is promoted, a group retires — and both are vocabulary
 * values, so the choice is made from a list at each end.
 *
 * Enforced in the Server Action against this list, not by the dialog: the
 * action is a public endpoint.
 */
export const BULK_EDITABLE: readonly string[] = ["status", "academicRank"];
