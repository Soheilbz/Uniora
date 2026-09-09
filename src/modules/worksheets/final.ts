import {
  defenceBoardTable,
  defenceSittingFields,
  finalReadinessTable,
  minuteReviewerRoles,
  noticeSittingFields,
  noticeSupervisorField,
  permitReviewerTable,
  studentFields,
  supervisionRoles,
  supervisorSignatures,
  supervisorTable,
} from "./blocks.ts";
import type { SheetDef } from "./model.ts";

/**
 * The seven forms of a defence: verifying the articles through to the notice on
 * the board.
 *
 * Transcriptions, like the proposal's — see `proposal.ts` for why a section
 * number or a column heading here is not something to tidy.
 */
export const FINAL_SHEETS = [
  /* ── 8. Verifying the articles ──────────────────────────────────────── */
  {
    id: "article-verification",
    labelKey: "sheet.index.articleVerification",
    titleKey: "sheet.title.articleVerification",
    category: "defense_permit",
    formCode: "F-R231-ARTICLE/ALL",
    sections: [
      /*
       * No student block. The form opens straight at section 1 — the sheet is
       * about the articles, and the case it belongs to is identified by the
       * file it is put in. A student list at the top would cost the form the
       * room its second section needs for seven rows and three checkbox groups.
       */
      {
        number: 1,
        title: "sheet.art.s1",
        blocks: [
          {
            kind: "fields",
            rows: [
              { label: "sheet.art.title", wide: true },
              { label: "sheet.art.doi" },
              { label: "sheet.art.journal" },
              { label: "sheet.art.pissn" },
              { label: "sheet.art.submitted" },
              { label: "sheet.art.accepted" },
              { label: "sheet.art.published" },
            ],
          },
          {
            kind: "choices",
            options: [
              "sheet.art.statusAccepted",
              "sheet.art.statusPublished",
              "sheet.art.typeResearch",
            ],
          },
          {
            kind: "choices",
            label: "sheet.art.quality",
            options: [
              "sheet.art.qDomestic",
              "sheet.art.qScopus",
              "sheet.art.qWos",
              "sheet.art.qIndexed",
              "sheet.art.qJcr",
            ],
          },
          {
            /* Six conditions. A seventh that repeated the dual-affiliation
               undertaking unqualified would read, on a signed checklist, as two
               separate things to certify. */
            kind: "choices",
            label: "sheet.art.conditions",
            options: [
              "sheet.art.notBlacklisted",
              "sheet.art.studentFirst",
              "sheet.art.supervisorCorresponding",
              "sheet.art.correctAffiliation",
              "sheet.art.matchesProposal",
              "sheet.art.noDualAffiliation",
            ],
          },
        ],
      },
      /*
       * The second article is verified against the same evidence as the first.
       * A shortened block here would accept one on a title, a journal and a DOI
       * — no ISSN, no dates, and no record that the journal was checked against
       * the invalid list or that the student is its first author.
       */
      {
        number: 2,
        title: "sheet.art.s2",
        blocks: [
          {
            kind: "fields",
            rows: [
              { label: "sheet.art.title", wide: true },
              { label: "sheet.art.doi" },
              { label: "sheet.art.journal" },
              { label: "sheet.art.pissn" },
              { label: "sheet.art.submitted" },
              { label: "sheet.art.accepted" },
              { label: "sheet.art.published" },
            ],
          },
          {
            kind: "choices",
            label: "sheet.art.pubStatus",
            options: [
              "sheet.art.majorRevision",
              "sheet.art.minorRevision",
              "sheet.art.stAccepted",
              "sheet.art.stPublished",
            ],
          },
          {
            kind: "choices",
            label: "sheet.art.quality",
            options: [
              "sheet.art.qDomestic",
              "sheet.art.qScopus",
              "sheet.art.qWos",
              "sheet.art.qIndexed",
              "sheet.art.qJcr",
            ],
          },
          {
            kind: "choices",
            label: "sheet.art.conditions",
            options: [
              "sheet.art.notBlacklisted",
              "sheet.art.studentFirst",
              "sheet.art.supervisorCorresponding",
              "sheet.art.correctAffiliation",
              "sheet.art.matchesProposal",
              "sheet.art.noDualAffiliation",
            ],
          },
        ],
      },
      {
        number: 3,
        title: "sheet.art.s3",
        blocks: [
          {
            kind: "fields",
            rows: [
              { label: "sheet.art.titlePlain", wide: true },
              { label: "sheet.art.conference" },
              { label: "sheet.art.organiser" },
            ],
          },
          {
            kind: "choices",
            label: "sheet.art.pubStatus",
            options: ["sheet.art.stAccepted", "sheet.art.stPublished", "sheet.art.stDigital"],
          },
        ],
      },
      {
        number: 4,
        title: "sheet.art.s4",
        blocks: [
          {
            kind: "fields",
            rows: [
              { label: "sheet.art.titlePlain", wide: true },
              { label: "sheet.art.conference" },
              { label: "sheet.art.organiser" },
            ],
          },
          {
            kind: "choices",
            label: "sheet.art.pubStatus",
            options: ["sheet.art.stAccepted", "sheet.art.stPublished", "sheet.art.stDigital"],
          },
        ],
      },
      {
        number: 5,
        title: "sheet.art.s5",
        blocks: [],
        signatures: [
          { label: "sheet.article.researchOfficer" },
          { label: "sheet.role.researchDeputy", field: "research_deputy" },
        ],
        /* Small print under the boxes, where the paper puts it. */
        footnote: "sheet.art.wosNote",
      },
    ],
  },
  /* ── 9. Permission to defend ────────────────────────────────────────── */
  {
    id: "defense-permit",
    labelKey: "sheet.index.defensePermit",
    titleKey: "sheet.title.defensePermit",
    category: "defense_permit",
    formCode: "F-R231-DEFENSE/ALL",
    sections: [
      {
        number: 1,
        title: "sheet.permit.s1.title",
        /* The sentence carries the record — name, number, field, degree, title
           and thesis code are all inside it. Repeating them as a labelled list
           underneath would print every one twice and cost the sheet a fifth of
           its height. */
        blocks: [{ kind: "paragraph", text: "sheet.permit.s1.body" }],
        signatures: [{ label: "sheet.f.studentFullName", field: "student_name" }],
      },
      {
        /* The doctorate alone must evidence its research output before it may
           defend, so this clause prints on that form only. It says the evidence
           is attached; a row listing the achievements on the form would
           contradict the sentence above it. */
        only: "doctorate",
        blocks: [{ kind: "paragraph", text: "sheet.permit.doctorateOnly" }],
      },
      {
        number: 2,
        title: "sheet.permit.s2.title",
        blocks: [{ kind: "paragraph", text: "sheet.permit.s2.body" }],
        signatures: [
          { label: "decisions.field.primarySupervisor" },
          { label: "sheet.permit.secondSupervisor", field: "secondary_supervisor" },
        ],
      },
      {
        number: 3,
        title: "sheet.permit.s3.title",
        blocks: [
          { kind: "paragraph", text: "sheet.permit.s3.to" },
          { kind: "paragraph", text: "sheet.permit.s3.body" },
        ],
        signatures: [
          { label: "sheet.permit.educationOffice", field: "education_office" },
          {
            label: "sheet.role.educationalCulturalDeputy",
            field: "educational_cultural_deputy",
          },
        ],
      },
      {
        number: 4,
        title: "sheet.permit.s4.title",
        blocks: [
          { kind: "paragraph", text: "sheet.permit.s4.to" },
          { kind: "paragraph", text: "sheet.permit.s4.body" },
        ],
        signatures: [
          { label: "sheet.role.departmentHead", field: "department_head" },
          { label: "sheet.role.groupManager", field: "group_manager" },
        ],
      },
      {
        number: 5,
        title: "sheet.permit.s5.title",
        blocks: [
          { kind: "paragraph", text: "sheet.permit.s5.body" },
          { kind: "note", text: "sheet.permit.table1" },
          supervisorTable,
          { kind: "note", text: "sheet.permit.table2" },
          /* «جدول ۲» is the board: four rows. The representative is named in the
             resolution above it, not seated in the table. */
          permitReviewerTable,
          { kind: "paragraph", text: "sheet.permit.closing" },
        ],
        /* The deputy alone. The council's resolution is minuted elsewhere; the
           box on this form belongs to the officer who acts on it. */
        signatures: [{ label: "sheet.role.researchDeputy", field: "research_deputy" }],
      },
    ],
  },
  /* ── 10. Scheduling the final defence ───────────────────────────────── */
  {
    id: "final-defense-schedule",
    labelKey: "sheet.index.finalDefenseSchedule",
    titleKey: "sheet.title.finalDefenseSchedule",
    category: "final_defense",
    formCode: "F-R231-DEF-SCHED/ALL",
    sections: [
      {
        number: 1,
        title: "sheet.finSched.s1.title",
        blocks: [
          { kind: "paragraph", text: "sheet.finSched.s1.to" },
          { kind: "paragraph", text: "sheet.finSched.s1.body" },
          studentFields,
          defenceSittingFields,
        ],
        signatures: supervisorSignatures,
      },
      {
        number: 2,
        title: "sheet.finSched.s2",
        blocks: [{ kind: "paragraph", text: "sheet.availabilityFinal" }, finalReadinessTable],
      },
      {
        number: 3,
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
        number: 4,
        title: "sheet.finSched.s3.title",
        blocks: [
          { kind: "paragraph", text: "sheet.finSched.s3.body" },
          { kind: "blank", label: "sheet.f.registrationNumber" },
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
  /* ── 11. Assessing the final defence ────────────────────────────────── */
  {
    id: "final-defense-evaluation",
    labelKey: "sheet.index.finalDefenseEvaluation",
    titleKey: "sheet.title.finalDefenseEvaluation",
    category: "final_defense",
    formCode: "F-R231-DEF-EVAL/ALL",
    footnote: "sheet.fin.markNote",
    sections: [
      {
        /*
         * The evaluation sheet asks for its own six things, in its own words:
         * «نام و نام خانوادگی», «شماره دانشجویی», «رشته / گرایش», «گروه آموزشی»,
         * «مقطع», «تاریخ دفاع» and the title. The shared student and thesis
         * blocks would put «کد پایان‌نامه» and «نوع تحقیق» on a mark sheet that
         * does not ask for them, and leave off the date being marked.
         */
        number: 1,
        title: "sheet.fin.s1",
        blocks: [
          {
            kind: "fields",
            rows: [
              { field: "student_name", label: "sheet.panel.name" },
              { field: "student_number", label: "decisions.field.studentNumber" },
              { field: "field_of_study", label: "sheet.fin.fieldAndSpecialism" },
              { field: "field_of_study", label: "sheet.fin.department" },
              { field: "education_level", label: "sheet.fin.level" },
              { field: "defense_meeting_date", label: "sheet.fin.defenseDate" },
              { field: "thesis_title", label: "decisions.field.thesisTitle", wide: true },
            ],
          },
        ],
      },
      {
        number: 2,
        title: "sheet.fin.criteria",
        blocks: [
          {
            /*
             * Eleven criteria under three headings and one mark for the work —
             * the form states no maximum against any of them. Inventing maxima
             * is not a detail on a signed instrument: an examiner marking
             * «ابتکار و نوآوری» out of 2 is marking to a rule the faculty never
             * issued.
             */
            kind: "rubric",
            criteria: [
              { label: "sheet.fin.priorResearch", group: "sheet.fin.academic" },
              { label: "sheet.fin.originality", group: "sheet.fin.academic" },
              { label: "sheet.fin.value", group: "sheet.fin.academic" },
              { label: "sheet.fin.conclusions", group: "sheet.fin.academic" },
              { label: "sheet.fin.sources", group: "sheet.fin.academic" },
              { label: "sheet.fin.timeliness", group: "sheet.fin.academic" },
              { label: "sheet.fin.achievements", group: "sheet.fin.academic" },
              { label: "sheet.fin.structure", group: "sheet.fin.writing" },
              { label: "sheet.fin.figures", group: "sheet.fin.writing" },
              { label: "sheet.fin.mastery", group: "sheet.fin.delivery" },
              { label: "sheet.fin.presentation", group: "sheet.fin.delivery" },
            ],
          },
        ],
      },
      {
        number: 3,
        title: "sheet.fin.s3",
        blocks: [
          {
            kind: "choices",
            options: [
              "sheet.c.acceptedNoChanges",
              "sheet.fin.acceptedWithRevisions",
              "sheet.c.failed",
            ],
          },
          { kind: "blank", label: "sheet.f.notes", field: "council_notes" },
          { kind: "blank", label: "sheet.f.finalTitle" },
        ],
      },
      /* Everyone who sat, which on this form is the supervision as well as the
         board: eleven rows. A five-row examiners table would leave the
         supervisors and advisors off the sheet that records the mark. */
      { number: 4, title: "sheet.fin.s4", blocks: [defenceBoardTable] },
      {
        number: 5,
        title: "sheet.fin.s5",
        blocks: [{ kind: "paragraph", text: "sheet.fin.representativeReport" }],
        signatures: [
          { label: "decisions.field.graduateStudiesRepresentative" },
          { label: "sheet.role.groupManager", field: "group_manager" },
          { label: "sheet.eval.researchDeputy", field: "research_deputy" },
        ],
      },
    ],
  },
  /* ── 12. Minuting the final defence ─────────────────────────────────── */
  {
    id: "defense-minutes",
    labelKey: "sheet.index.defenseMinutes",
    titleKey: "sheet.title.defenseMinutes",
    chrome: "minute",
    registration: true,
    category: "final_defense",
    formCode: "F-R231-DEF-MIN/11",
    /*
     * The one sheet that is not a form.
     *
     * This minute is bound into the thesis, so it is set as a letter: the
     * sitting in a paragraph, the grade on its own line, then the supervision
     * and the board written out in numbered sentences and four officers named
     * at the foot. No ruled tables, no caption-and-value list, no section
     * headings — all three would make a filing form of the page that goes into
     * the bound copy.
     *
     * The bound copy keeps its wider binding edge and is set in the bundled
     * Nastaliq face. Those are print properties rather than content, so they
     * live in the shared paper stylesheet and cannot drift from this definition.
     */
    sections: [
      {
        blocks: [
          { kind: "paragraph", text: "sheet.defMin.body" },
          { kind: "grade", label: "sheet.defMin.grade" },
          { kind: "roster", title: "sheet.section.supervisors", roles: supervisionRoles },
          { kind: "roster", title: "sheet.section.reviewers", roles: minuteReviewerRoles },
        ],
        /* The four officers who countersign a bound minute. The examiners have
           already signed in the roster above; printing them here instead would
           send the document out without the signatures that ratify it. */
        signatures: [
          { label: "decisions.field.graduateStudiesRepresentative", inline: true },
          { label: "sheet.minute.groupManager", field: "group_manager", inline: true },
          { label: "sheet.minute.researchDeputy", field: "research_deputy", inline: true },
          { label: "sheet.role.facultyDean", field: "faculty_dean", inline: true },
        ],
      },
    ],
  },
  /* ── 13. The originality declaration ────────────────────────────────── */
  {
    id: "originality-declaration",
    labelKey: "sheet.index.originalityDeclaration",
    titleKey: "sheet.title.originalityDeclaration",
    chrome: "declaration",
    category: "final_defense",
    formCode: "F-R231-AUTH/12",
    sections: [
      {
        blocks: [
          { kind: "paragraph", text: "sheet.orig.opening" },
          {
            /* Seven undertakings, carried word for word. The third assigns
               intellectual property to the university; a paraphrase is not the
               same instrument, which is why this is the one place in the
               application where the wording must not be shortened. */
            kind: "declarations",
            items: [
              "sheet.orig.c1",
              "sheet.orig.c2",
              "sheet.orig.c3",
              "sheet.orig.c4",
              "sheet.orig.c5",
              "sheet.orig.c6",
              "sheet.orig.c7",
            ],
          },
          {
            kind: "fields",
            rows: [
              { field: "student_name", label: "sheet.role.student" },
              { field: "student_number", label: "decisions.field.studentNumber" },
              { label: "sheet.f.dateAndSignature" },
            ],
          },
          { kind: "paragraph", text: "sheet.orig.supervisorConfirmation" },
        ],
        /* Rank and faculty beside the name, and «تاریخ و امضا» rather than
           «امضا»: these two sign a declaration that assigns intellectual
           property, and they appear in no table on the sheet, so the box is the
           only place the document identifies them. */
        signatures: [
          { label: "decisions.field.primarySupervisor", detailed: true, dated: true },
          { label: "decisions.field.secondarySupervisor", detailed: true, dated: true },
        ],
      },
    ],
  },
  /* ── 14. Announcing the final defence ───────────────────────────────── */
  {
    id: "final-defense-notice",
    labelKey: "sheet.index.finalDefenseNotice",
    chrome: "notice",
    subtitleKey: "sheet.notice.finalSubtitle",
    category: "final_defense",
    sections: [
      {
        title: "sheet.notice.studentAndSupervisors",
        blocks: [studentFields, noticeSupervisorField],
      },
      {
        title: "sheet.notice.thesisTitle",
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
] satisfies SheetDef[];
