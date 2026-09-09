import {
  councilSignature,
  defenceSittingFields,
  noticeSittingFields,
  noticeSupervisorField,
  readinessTable,
  requestInviteTable,
  requestPanelTable,
  reviewerTable,
  seminarBoardTable,
  studentFields,
  supervisionTable,
  supervisorSignatures,
} from "./blocks.ts";
import type { SheetDef } from "./model.ts";

/**
 * The seven forms of a proposal: appointing a supervisor through to marking the
 * seminar.
 *
 * These are transcriptions of paper the university issues, so what is here is
 * not a design. A section number, a form code, the order of two tick-boxes and
 * the wording of a column heading are all on sheets already signed and filed,
 * and a form that differs from them is a different instrument.
 */
export const PROPOSAL_SHEETS = [
  /* ── 1. Appointing a supervisor ─────────────────────────────────────── */
  {
    id: "supervisor-selection",
    labelKey: "sheet.index.supervisorSelection",
    titleKey: "sheet.title.supervisorSelection",
    category: "supervisor_selection",
    formCode: "F-R231-01/ALL",
    sections: [
      {
        number: 1,
        title: "sheet.sup.s1.title",
        blocks: [
          { kind: "paragraph", text: "sheet.sup.s1.to" },
          /* The sentence carries the record — the name, degree, field and
             number are all inside it, and a four-row list repeating them
             underneath would print every one of them twice. The intake note is
             there too, as two gaps to complete in ink. */
          { kind: "paragraph", text: "sheet.sup.s1.body" },
        ],
        signatures: [{ label: "sheet.role.student", field: "student_name" }],
      },
      {
        number: 2,
        title: "sheet.sup.s2.title",
        blocks: [
          { kind: "paragraph", text: "sheet.sup.s2.to" },
          { kind: "paragraph", text: "sheet.sup.s2.body" },
        ],
        signatures: [
          { label: "decisions.field.primarySupervisor", detailed: true },
          { label: "decisions.field.secondarySupervisor", detailed: true },
          { label: "decisions.field.thirdSupervisor", detailed: true },
        ],
      },
      {
        number: 3,
        title: "sheet.sup.s3.title",
        blocks: [
          { kind: "paragraph", text: "sheet.sup.s3.to" },
          { kind: "paragraph", text: "sheet.sup.s3.body" },
        ],
        signatures: [
          { label: "sheet.role.departmentHead", field: "department_head" },
          { label: "sheet.role.groupManager", field: "group_manager" },
        ],
      },
      {
        /*
         * Printed on the professional-doctorate form only: the comprehensive
         * exam is a precondition for that degree and no other. That leaves the
         * form numbered 1, 2, 3, 5, 6 on every other degree, and the skipped
         * number is deliberate — asking a master's education office to certify
         * a comprehensive exam that degree does not sit is the worse of the
         * two readings.
         */
        number: 4,
        title: "sheet.sup.s4.title",
        only: "professionalDoctorate",
        blocks: [
          { kind: "paragraph", text: "sheet.sup.s4.to" },
          { kind: "paragraph", text: "sheet.sup.s4.body" },
        ],
        signatures: [{ label: "sheet.role.educationOffice", field: "education_office" }],
      },
      {
        number: 5,
        title: "sheet.sup.s5.title",
        blocks: [
          { kind: "paragraph", text: "sheet.sup.s5.body" },
          {
            kind: "choices",
            options: [
              "sheet.c.agreed",
              "sheet.c.notAgreed",
              "sheet.c.hasCapacity",
              "sheet.c.noCapacity",
            ],
          },
          { kind: "blank", label: "sheet.f.notes", lines: 2, field: "council_notes" },
        ],
        signatures: [{ label: "sheet.role.researchDeputy", field: "research_deputy" }],
      },
      {
        number: 6,
        title: "sheet.sup.s6",
        blocks: [{ kind: "choices", options: ["sheet.c.registered"] }],
        signatures: [{ label: "sheet.role.educationOffice", field: "education_office" }],
      },
    ],
  },
  /* ── 2. Choosing a doctoral topic ───────────────────────────────────── */
  {
    id: "doctoral-topic",
    labelKey: "sheet.index.doctoralTopic",
    titleKey: "sheet.title.doctoralTopic",
    category: "proposal",
    formCode: "F-R231-01/02",
    sections: [
      {
        number: 1,
        title: "sheet.topic.s1.title",
        blocks: [{ kind: "paragraph", text: "sheet.topic.s1.body" }],
        signatures: [
          { label: "sheet.role.student", field: "student_name" },
          ...supervisorSignatures,
        ],
      },
      {
        number: 2,
        title: "sheet.topic.s2.title",
        blocks: [
          { kind: "paragraph", text: "sheet.topic.s2.body" },
          { kind: "choices", options: ["sheet.c.agreed", "sheet.c.notAgreed"] },
          { kind: "blank", label: "sheet.f.notes", lines: 2, field: "council_notes" },
        ],
        signatures: [{ label: "sheet.role.groupManager", field: "group_manager" }],
      },
      {
        number: 3,
        title: "sheet.topic.s3.title",
        blocks: [
          { kind: "paragraph", text: "sheet.topic.s3.body" },
          { kind: "choices", options: ["sheet.c.agreed", "sheet.c.notAgreed"] },
          { kind: "blank", label: "sheet.f.notes", lines: 2, field: "council_notes" },
        ],
        signatures: councilSignature,
      },
    ],
  },
  /* ── 3. Requesting a proposal defence ───────────────────────────────── */
  {
    id: "proposal-defense-request",
    labelKey: "sheet.index.proposalDefenseRequest",
    titleKey: "sheet.title.proposalDefenseRequest",
    registration: true,
    category: "proposal",
    formCode: "F-R231-PROP-REQ/03",
    sections: [
      {
        number: 1,
        title: "sheet.propReq.s1.title",
        blocks: [
          { kind: "paragraph", text: "sheet.propReq.s1.to" },
          { kind: "paragraph", text: "sheet.propReq.s1.body" },
        ],
        signatures: [
          { label: "sheet.role.student", field: "student_name" },
          ...supervisorSignatures,
        ],
      },
      {
        number: 2,
        title: "sheet.propReq.s2.title",
        blocks: [
          { kind: "paragraph", text: "sheet.propReq.s2.to" },
          { kind: "paragraph", text: "sheet.propReq.s2.body" },
          { kind: "choices", options: ["sheet.c.accepted", "sheet.c.notAccepted"] },
          requestPanelTable,
        ],
        signatures: [
          { label: "sheet.role.departmentHead", field: "department_head" },
          { label: "sheet.role.groupManager", field: "group_manager" },
        ],
      },
      {
        number: 3,
        title: "sheet.propReq.s3.title",
        blocks: [{ kind: "paragraph", text: "sheet.propReq.s3.body" }, requestInviteTable],
        signatures: [{ label: "sheet.role.researchDeputy", field: "research_deputy" }],
      },
    ],
  },
  /* ── 4. Scheduling the proposal defence ─────────────────────────────── */
  {
    id: "proposal-defense-schedule",
    labelKey: "sheet.index.proposalDefenseSchedule",
    titleKey: "sheet.title.proposalDefenseSchedule",
    referenceDate: "defense",
    registration: true,
    category: "proposal_defense",
    formCode: "F-R231-PROP-SCHED/04",
    sections: [
      {
        number: 1,
        title: "sheet.propSched.s1.title",
        blocks: [
          { kind: "paragraph", text: "sheet.propSched.s1.to" },
          { kind: "paragraph", text: "sheet.propSched.s1.body" },
          studentFields,
          defenceSittingFields,
        ],
      },
      {
        /* The supervisors confirm the time before the board is canvassed, and
           all three seats sign it — the paper rules three boxes for them. */
        number: 2,
        title: "sheet.propSched.s2sup",
        blocks: [],
        signatures: supervisorSignatures,
      },
      {
        number: 3,
        title: "sheet.propSched.s2",
        blocks: [{ kind: "paragraph", text: "sheet.availability" }, readinessTable],
      },
      {
        number: 4,
        title: "sheet.sched.repReadiness",
        blocks: [
          {
            kind: "fields",
            rows: [
              {
                field: "graduate_studies_representative",
                label: "sheet.sched.repName",
                wide: true,
              },
            ],
          },
        ],
        signatures: [{ label: "decisions.field.graduateStudiesRepresentative", detailed: true }],
      },
      {
        number: 5,
        title: "sheet.propSched.s3.title",
        blocks: [
          { kind: "paragraph", text: "sheet.propSched.s3.body" },
          { kind: "choices", options: ["sheet.c.permitApproved"] },
          { kind: "blank", label: "sheet.f.classAssignment" },
          {
            kind: "choices",
            label: "sheet.sched.ictConfirmation",
            options: ["sheet.c.inPerson", "sheet.c.remote"],
          },
          { kind: "blank", label: "sheet.f.virtualLink" },
        ],
        signatures: [{ label: "sheet.role.researchOfficer" }],
      },
    ],
  },
  /* ── 5. Minuting the proposal defence ───────────────────────────────── */
  {
    id: "proposal-defense-minutes",
    labelKey: "sheet.index.proposalDefenseMinutes",
    titleKey: "sheet.title.proposalDefenseMinutes",
    referenceDate: "defense",
    registration: true,
    category: "proposal_defense",
    formCode: "F-R231-PROP-MIN/05",
    sections: [
      /*
       * Five sections, and two of them are the tables. The sheet that records
       * who sat on a proposal defence has to name the supervisors, the advisors
       * and the board — the sentence in section 1 says only that a sitting was
       * held. The student, thesis and sitting details are inside that sentence,
       * so they are not also listed beside it.
       */
      {
        number: 1,
        title: "sheet.propMin.s1",
        blocks: [{ kind: "paragraph", text: "sheet.propMin.body" }],
      },
      { number: 2, title: "sheet.propMin.s2", blocks: [supervisionTable] },
      { number: 3, title: "sheet.propMin.s3", blocks: [reviewerTable] },
      {
        number: 4,
        title: "sheet.section.resolution",
        blocks: [
          {
            kind: "choices",
            options: [
              "sheet.c.propAccepted",
              "sheet.c.propAcceptedWithChanges",
              "sheet.c.propRejected",
            ],
          },
          { kind: "blank", label: "sheet.f.notes", lines: 2, field: "council_notes" },
          {
            kind: "choices",
            label: "decisions.field.researchType",
            options: [
              "sheet.c.theoretical",
              "sheet.c.fieldwork",
              "sheet.c.experimental",
              "sheet.c.changesMade",
            ],
          },
        ],
      },
      {
        number: 5,
        title: "sheet.propMin.s5",
        blocks: [{ kind: "paragraph", text: "sheet.propMin.closing" }],
        signatures: [
          { label: "decisions.field.graduateStudiesRepresentative" },
          { label: "sheet.role.groupManager", field: "group_manager" },
          { label: "sheet.role.researchDeputy", field: "research_deputy" },
        ],
      },
    ],
  },
  /* ── 6. Announcing the proposal defence ─────────────────────────────── */
  {
    id: "proposal-defense-notice",
    labelKey: "sheet.index.proposalDefenseNotice",
    chrome: "notice",
    subtitleKey: "sheet.notice.proposalSubtitle",
    category: "proposal_defense",
    sections: [
      {
        title: "sheet.notice.studentAndSupervision",
        blocks: [studentFields, noticeSupervisorField],
      },
      {
        title: "sheet.notice.proposalTitle",
        blocks: [{ kind: "fields", rows: [{ field: "thesis_title", label: "", wide: true }] }],
      },
      { title: "sheet.notice.whenAndWhere", blocks: [noticeSittingFields] },
      {
        blocks: [
          { kind: "note", text: "sheet.notice.welcome" },
          { kind: "note", text: "sheet.notice.issuedBy" },
        ],
      },
    ],
  },
  /* ── 7. Assessing a master's seminar ────────────────────────────────── */
  {
    id: "masters-seminar-evaluation",
    labelKey: "sheet.index.mastersSeminarEvaluation",
    titleKey: "sheet.title.mastersSeminarEvaluation",
    referenceDate: "defense",
    category: "proposal_defense",
    formCode: "F-R231-SEM/06",
    sections: [
      {
        number: 1,
        title: "sheet.sem.s1",
        /*
         * The seminar's own six captions, which are not the shared student
         * block's: it asks for «گروه آموزشی» and «رشته» rather than «مقطع
         * تحصیلی» and «رشته تحصیلی», and it asks for all the supervisors on one
         * line rather than the first alone.
         */
        blocks: [
          {
            kind: "fields",
            rows: [
              { field: "student_name", label: "sheet.f.studentFullName" },
              { field: "student_number", label: "decisions.field.studentNumber" },
              { field: "field_of_study", label: "sheet.sem.department" },
              { field: "field_of_study", label: "sheet.sem.field" },
              { field: "defense_meeting_date", label: "sheet.f.seminarDate" },
              { field: "primary_supervisor", label: "sheet.sem.supervisors" },
              { field: "thesis_title", label: "sheet.f.seminarTitle", wide: true },
            ],
          },
        ],
      },
      {
        number: 2,
        title: "sheet.sem.s2",
        blocks: [
          {
            /*
             * The weighted scheme from the paper form, marked per heading:
             * «بررسی کار دیگران» is worth five between its two criteria and
             * takes one mark, not three and two in separate boxes. The renderer
             * sums the criteria under a heading and spans the mark across them.
             */
            kind: "rubric",
            total: 20,
            criteria: [
              { label: "sheet.sem.titleFit", max: 1 },
              { label: "sheet.sem.problem", max: 2 },
              { label: "sheet.sem.priorVolume", max: 3, group: "sheet.sem.prior" },
              { label: "sheet.sem.priorAnalysis", max: 2, group: "sheet.sem.prior" },
              { label: "sheet.sem.clarity", max: 2, group: "sheet.sem.proposal" },
              { label: "sheet.sem.originality", max: 2, group: "sheet.sem.proposal" },
              { label: "sheet.sem.rationale", max: 1, group: "sheet.sem.proposal" },
              { label: "sheet.sem.method", max: 2, group: "sheet.sem.proposal" },
              { label: "sheet.sem.references", max: 1 },
              { label: "sheet.sem.writing", max: 2 },
              { label: "sheet.sem.delivery", max: 2 },
            ],
          },
        ],
      },
      { number: 3, title: "sheet.sem.board", blocks: [seminarBoardTable] },
      {
        /* The sheet closes with the verdict sentence, then the representative
           and the group manager signing the mark by name. */
        number: 4,
        title: "sheet.sem.s4",
        blocks: [{ kind: "paragraph", text: "sheet.sem.verdict" }],
        signatures: [
          { label: "sheet.sem.repSignature", field: "graduate_studies_representative" },
          { label: "sheet.sem.groupManagerSignature", field: "group_manager" },
        ],
      },
    ],
  },
] satisfies SheetDef[];
