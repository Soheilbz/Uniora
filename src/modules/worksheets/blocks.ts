import type { PanelRole, SheetBlock, SignatureSpec } from "./model.ts";

/**
 * The pieces more than one form is built from.
 *
 * Shared so the same fact is asked for the same way on every sheet that asks
 * it — and only where the paper genuinely agrees. The tables below are *not*
 * shared, because the paper forms do not share them: they rule different
 * numbers of columns under different headings, and those headings are on sheets
 * the office has already filed.
 */

export const studentFields: SheetBlock = {
  kind: "fields",
  rows: [
    { field: "student_name", label: "sheet.f.studentFullName" },
    { field: "student_number", label: "decisions.field.studentNumber" },
    { field: "education_level", label: "decisions.field.educationLevel" },
    { field: "field_of_study", label: "decisions.field.fieldOfStudy" },
  ],
};

/**
 * A notice's own way of naming people and times.
 *
 * A notice is pinned to a board for readers who are filing nothing: it
 * addresses the supervisor as «استاد محترم راهنما» rather than listing the six
 * supervisor and advisor seats a form needs, and it labels the sitting by day,
 * time and place in the words on the paper.
 */
export const noticeSupervisorField: SheetBlock = {
  kind: "fields",
  rows: [{ field: "primary_supervisor", label: "sheet.notice.supervisor", wide: true }],
};

export const noticeSittingFields: SheetBlock = {
  kind: "fields",
  rows: [
    {
      field: "defense_meeting_day",
      also: "defense_meeting_date",
      label: "sheet.notice.dayAndDate",
    },
    /* «ساعت ۱۱:۳۰», not «۱۱:۳۰» — the word is part of what the notice prints in
       that pod, and without it a poster carries a bare number. */
    { field: "defense_meeting_time", label: "sheet.notice.time", prefix: "sheet.notice.hourWord" },
    { field: "defense_meeting_location", label: "sheet.notice.place" },
  ],
};

export const defenceSittingFields: SheetBlock = {
  kind: "fields",
  rows: [
    { field: "defense_meeting_date", label: "decisions.field.defenseMeetingDate" },
    { field: "defense_meeting_day", label: "decisions.field.defenseMeetingDay" },
    { field: "defense_meeting_time", label: "decisions.field.defenseMeetingTime" },
    { field: "defense_meeting_location", label: "decisions.field.defenseMeetingLocation" },
  ],
};

/* ── The ruled panels, each with the columns its own form rules ─────────── */

/*
 * Columns are per form, because the paper's are.
 *
 * One five-column set shared across every table would be tidier and wrong: the
 * proposal-defence request rules seven columns with a row number and the
 * student's field among them, the defence permit rules four and no signature,
 * and the seminar heads its first column «اعضای هیئت داوران» where the minute
 * heads it «سمت».
 *
 * The renderer decides what goes under a column from the column's own key, so a
 * table here is described by naming its columns and its rows and nothing else.
 */

/** «سمت | نام و نام خانوادگی | مرتبه علمی | دانشکده/ دانشگاه | امضا» */
const MINUTE_COLUMNS = [
  "sheet.panel.seat",
  "sheet.panel.name",
  "sheet.panel.rank",
  "sheet.panel.facultyUniversity",
  "sheet.panel.signature",
];

/** Three supervisors and three advisors, as the minute sheets rule them. */
export const supervisionRoles: PanelRole[] = [
  "decisions.field.primarySupervisor",
  "decisions.field.secondarySupervisor",
  "decisions.field.thirdSupervisor",
  "decisions.field.firstAdvisor",
  "decisions.field.secondAdvisor",
  "decisions.field.thirdAdvisor",
];

/** The board alone, without the representative; the fourth seat is the guest. */
export const reviewerRoles: PanelRole[] = [
  "decisions.field.reviewer1",
  "decisions.field.reviewer2",
  "decisions.field.reviewer3",
  "decisions.field.reviewer4Invited",
];

/**
 * The same four seats where the form heads the last one «داور چهارم».
 *
 * Some forms word it that way and some «داور چهارم (مدعو)». The seat is the
 * same seat and the column is the same column; what differs is the paper, and
 * the paper is what has to match.
 */
export const plainReviewerRoles: PanelRole[] = [
  "decisions.field.reviewer1",
  "decisions.field.reviewer2",
  "decisions.field.reviewer3",
  { label: "sheet.role.reviewer4", field: "reviewer4_invited" },
];

/** The four seats as the bound minute writes them, ending «داور مدعو». */
export const minuteReviewerRoles: PanelRole[] = [
  "decisions.field.reviewer1",
  "decisions.field.reviewer2",
  "decisions.field.reviewer3",
  { label: "sheet.minute.invitedReviewer", field: "reviewer4_invited" },
];

export const supervisionTable: SheetBlock = {
  kind: "panel",
  columns: MINUTE_COLUMNS,
  roles: supervisionRoles,
};

export const reviewerTable: SheetBlock = {
  kind: "panel",
  columns: MINUTE_COLUMNS,
  roles: reviewerRoles,
};

/**
 * The request's own table: a row number, the student's field, and two columns
 * the department completes at the sitting.
 *
 * Seven columns, four rows — the board only. The representative is named in
 * section 3's table, not in this one.
 */
export const requestPanelTable: SheetBlock = {
  kind: "panel",
  columns: [
    "sheet.panel.index",
    "sheet.panel.name",
    "sheet.panel.rank",
    "sheet.panel.fieldOfStudy",
    "sheet.panel.specialty",
    "sheet.panel.university",
    "sheet.panel.seatBlank",
  ],
  roles: reviewerRoles,
};

/**
 * The council's own table on the request: who it invites, and no signature
 * column, because nobody signs a resolution that records an invitation.
 *
 * The three examiners are each headed «هیأت داوران» — the form names the body
 * rather than the seat — and the representative is named under their own.
 */
export const requestInviteTable: SheetBlock = {
  kind: "panel",
  columns: [
    "sheet.panel.seat",
    "sheet.panel.name",
    "sheet.panel.rank",
    "sheet.panel.facultyUniversity",
  ],
  roles: [
    { label: "sheet.role.panelMember", field: "reviewer1" },
    { label: "sheet.role.panelMember", field: "reviewer2" },
    { label: "sheet.role.panelMember", field: "reviewer3" },
    "decisions.field.graduateStudiesRepresentative",
  ],
};

/**
 * Everyone who must be available before a proposal sitting can be scheduled.
 *
 * The advisors and the board, and not the supervisors: the supervisors have
 * already signed the section above — they are the ones proposing the time. This
 * form words the advisors without «استاد» in front of them, which the
 * final-defence form does not.
 */
export const readinessTable: SheetBlock = {
  kind: "panel",
  columns: [
    "sheet.panel.seatShort",
    "sheet.panel.name",
    "sheet.panel.rank",
    "sheet.panel.university",
    "sheet.panel.signatureAndDate",
  ],
  roles: [
    { label: "sheet.role.advisor1", field: "first_advisor" },
    { label: "sheet.role.advisor2", field: "second_advisor" },
    { label: "sheet.role.advisor3", field: "third_advisor" },
    ...reviewerRoles,
  ],
};

/** The same table on the final-defence form, in that form's own wording. */
export const finalReadinessTable: SheetBlock = {
  kind: "panel",
  columns: [
    "sheet.panel.role",
    "sheet.panel.name",
    "sheet.panel.rank",
    "sheet.panel.university",
    "sheet.panel.signatureAndDateFull",
  ],
  roles: [
    "decisions.field.firstAdvisor",
    "decisions.field.secondAdvisor",
    "decisions.field.thirdAdvisor",
    ...plainReviewerRoles,
  ],
};

/** The three supervisors, as the scheduling forms ask them to confirm a time. */
export const supervisorSignatures: SignatureSpec[] = [
  { label: "decisions.field.primarySupervisor" },
  { label: "decisions.field.secondarySupervisor" },
  { label: "decisions.field.thirdSupervisor" },
];

/**
 * The seminar's board, which is one table rather than two: both supervisors,
 * all three advisors, the two examiners and the representative who chairs.
 */
export const seminarBoardTable: SheetBlock = {
  kind: "panel",
  columns: [
    "sheet.panel.boardMembers",
    "sheet.panel.name",
    "sheet.panel.rank",
    "sheet.panel.universityName",
    "sheet.panel.signature",
  ],
  roles: [
    { label: "sheet.sem.role.supervisor1", field: "primary_supervisor" },
    { label: "sheet.sem.role.supervisor2", field: "secondary_supervisor" },
    "decisions.field.firstAdvisor",
    "decisions.field.secondAdvisor",
    "decisions.field.thirdAdvisor",
    { label: "sheet.sem.role.reviewer1", field: "reviewer1" },
    { label: "sheet.sem.role.reviewer2", field: "reviewer2" },
    "decisions.field.graduateStudiesRepresentative",
  ],
};

/**
 * Everyone who sat at a final defence: the supervision, the board and the
 * representative, which is the one table the evaluation sheet rules.
 */
export const defenceBoardTable: SheetBlock = {
  kind: "panel",
  columns: MINUTE_COLUMNS,
  roles: [
    ...supervisionRoles,
    ...plainReviewerRoles,
    "decisions.field.graduateStudiesRepresentative",
  ],
};

/** The four columns the defence permit rules for both of its tables. */
const PERMIT_COLUMNS = [
  "sheet.panel.seat",
  "sheet.panel.name",
  "sheet.panel.rank",
  "sheet.panel.facultyUniversityName",
];

/** «جدول ۱»: the supervision, with no signature column. */
export const supervisorTable: SheetBlock = {
  kind: "panel",
  columns: PERMIT_COLUMNS,
  roles: supervisionRoles,
};

/** «جدول ۲»: the board, four rows, the same columns. */
export const permitReviewerTable: SheetBlock = {
  kind: "panel",
  columns: PERMIT_COLUMNS,
  roles: plainReviewerRoles,
};

/**
 * The one box a council resolution is signed in: the deputy, who signs for the
 * council. The other officers sign their own sections higher up the sheet.
 */
export const councilSignature: SignatureSpec[] = [
  { label: "sheet.role.researchDeputy", field: "research_deputy" },
];
