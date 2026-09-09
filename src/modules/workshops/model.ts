import type { AnyFieldSpec } from "@/lib/register/field-spec.ts";
import type { FilterDef, RegisterSpec } from "@/lib/register/spec.ts";

/**
 * The workshop register, and what a workshop record holds.
 *
 * Uses the shared field shape rather than declaring another one: the kinds are
 * the same — a text box, a date, a vocabulary, a number — and a third parallel
 * definition of "what a field is" would be a third place to fix a bug in how
 * dates are validated.
 */

const WORKSHOP_FILTERS = [
  { key: "status", set: "workshop_statuses", narrowedBy: null },
  { key: "location", set: "workshop_locations", narrowedBy: null },
] as const satisfies readonly FilterDef[];

export const WORKSHOPS_REGISTER: RegisterSpec = {
  basePath: "/workshops",
  filters: WORKSHOP_FILTERS,
  /*
   * `participants` is absent. It is a correlated count, and SQL could order by
   * it — but a column that sorts by a number the reader cannot see derived is a
   * column that produces surprises. The count is shown; the order is by date,
   * which is how an office looks for a workshop.
   */
  sortable: ["title", "workshopDate", "capacity"],
  defaultSort: "workshopDate",
  defaultDirection: "desc",
};

export const WORKSHOP_LOOKUP_SETS: readonly string[] = [
  "workshop_statuses",
  "workshop_locations",
  "attendance_statuses",
  "payment_statuses",
  "instructor_roles",
];

export interface WorkshopRow {
  id: string;
  version: number;
  title: string;
  workshopDate: string | null;
  durationHours: string | null;
  locationType: string | null;
  venue: string | null;
  capacity: number;
  status: string;
  /** How many have registered, and how many of those attended. */
  registered: number;
  attended: number;
  certificates: number;
}

/**
 * The four registers this screen holds, and why they are not four screens.
 *
 * A workshop, the people who taught it, the people who attended it, and the
 * certificates that came out of it. They are four tables, but they are one
 * question — «what has this office run, and for whom» — and an office looking
 * for a name does not know in advance which of the four it is filed under: a
 * guest who taught in March and attended in June is on two of them.
 *
 * The three after the first are *cross-workshop* views. Each workshop's record
 * page already lists its own instructors and attendees; what these add is the
 * other axis, which is the one nothing else answers — «every certificate this
 * year», «is this person on any register at all».
 */
export const WORKSHOP_TABS = ["workshops", "instructors", "participants", "certificates"] as const;
export type WorkshopTab = (typeof WORKSHOP_TABS)[number];

export function isWorkshopTab(value: unknown): value is WorkshopTab {
  return typeof value === "string" && (WORKSHOP_TABS as readonly string[]).includes(value);
}

/**
 * Who taught, across every workshop.
 *
 * No filters: the vocabulary that would narrow this is `instructor_roles`, and
 * with two values — main and assistant — a dropdown offering «all / main /
 * assistant» beside a search box is a control that earns nothing. The role is a
 * column, visible on every row at once.
 */
export const INSTRUCTORS_REGISTER: RegisterSpec = {
  basePath: "/workshops",
  filters: [],
  sortable: ["name", "workshop", "role"],
  defaultSort: "workshop",
  defaultDirection: "desc",
};

/**
 * Who attended, across every workshop.
 *
 * Both vocabularies narrow something an office actually asks for: «who has not
 * paid» and «who registered but did not come» are the two lists that get chased.
 */
export const PARTICIPANTS_REGISTER: RegisterSpec = {
  basePath: "/workshops",
  filters: [
    { key: "attendance", set: "attendance_statuses", narrowedBy: null },
    { key: "payment", set: "payment_statuses", narrowedBy: null },
  ],
  sortable: ["name", "workshop", "registered", "attendance", "payment"],
  defaultSort: "workshop",
  defaultDirection: "desc",
};

/**
 * What was issued.
 *
 * Sorted by issue date descending by default — a certificate register is read
 * from the present backwards, and «what went out this week» is the question.
 */
export const CERTIFICATES_REGISTER: RegisterSpec = {
  basePath: "/workshops",
  filters: [],
  sortable: ["number", "issued", "name", "workshop"],
  defaultSort: "issued",
  defaultDirection: "desc",
};

export const REGISTER_FOR_TAB: Record<WorkshopTab, RegisterSpec> = {
  workshops: WORKSHOPS_REGISTER,
  instructors: INSTRUCTORS_REGISTER,
  participants: PARTICIPANTS_REGISTER,
  certificates: CERTIFICATES_REGISTER,
};

/** One instructor's seat on one workshop. */
export interface InstructorRow {
  id: string;
  workshopId: string;
  workshopTitle: string;
  workshopDate: string | null;
  /** The directory's name where the id resolves, the minuted one otherwise. */
  name: string;
  /** Set when this is somebody on staff, so the row can link to their record. */
  professorId: string | null;
  nationalId: string | null;
  affiliation: string | null;
  role: string;
}

/** One person's place on one workshop's register. */
export interface ParticipantRow {
  id: string;
  workshopId: string;
  workshopTitle: string;
  workshopDate: string | null;
  name: string;
  studentId: string | null;
  studentNumber: string | null;
  nationalId: string | null;
  mobile: string | null;
  affiliation: string | null;
  registrationDate: string | null;
  attendanceStatus: string;
  paymentStatus: string;
  /** Whether a certificate has been issued for this seat. */
  certificateNumber: string | null;
}

/** One issued certificate. */
export interface CertificateRow {
  id: string;
  workshopId: string;
  workshopTitle: string;
  workshopDate: string | null;
  /** True when the source workshop was retired after this certificate was issued. */
  workshopRetired: boolean;
  participantId: string;
  name: string;
  studentId: string | null;
  certificateNumber: string;
  issueDate: string;
  verificationCode: string;
}

export const WORKSHOP_GROUPS = ["session", "place", "enrolment"] as const;
export type WorkshopGroup = (typeof WORKSHOP_GROUPS)[number];

const field = (
  key: string,
  group: WorkshopGroup,
  extra: Partial<AnyFieldSpec> = {},
): AnyFieldSpec => ({ key, kind: "text", group, ...extra });

export const WORKSHOP_FIELDS: readonly AnyFieldSpec[] = [
  field("title", "session", { maxLength: 300, required: true }),
  field("description", "session", { maxLength: 4000 }),
  { key: "workshopDate", kind: "date", group: "session" },
  /*
   * Hours as a number with a fraction: a half-day workshop is 4.5, and the
   * certificate prints the figure. Bounded because «۸۰۰ ساعت» is a typo, not a
   * workshop.
   */
  { key: "durationHours", kind: "number", group: "session", min: 0, max: 200, scale: 2 },

  { key: "locationType", kind: "lookup", group: "place", set: "workshop_locations" },
  field("venue", "place", { maxLength: 300 }),

  { key: "capacity", kind: "number", group: "enrolment", min: 0, max: 10_000 },
  { key: "cost", kind: "number", group: "enrolment", min: 0, max: 1_000_000_000, scale: 2 },
  { key: "status", kind: "lookup", group: "enrolment", set: "workshop_statuses" },
];
