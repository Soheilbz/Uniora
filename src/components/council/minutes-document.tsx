import type { SittingPapers } from "@/modules/council/papers.ts";
import {
  attendance,
  isNamed,
  normalizeSpacing,
  type SittingDecision,
  withHonorific,
} from "@/modules/council/sittings.ts";
import { SectionTitle, Sheet, SittingDetails, type SittingLabels } from "./paper";

/**
 * The minute: the sitting as a document, for signature and for the file.
 *
 * Four lettered sections in the order the council takes them — (الف) proposals
 * cleared for defence, (ب) theses cleared for their final defence, (ج)
 * everything else it ruled on, (د) the supervisors it appointed.
 *
 * ── Each resolution is a sentence, not a row ────────────────────────────────
 *
 * This is what separates a minute from a table. The council resolves in prose —
 * «درخواست دفاع از پیشنهاده پایان‌نامه X دانشجوی مقطع Y رشته Z با عنوان «…»،
 * مطرح و به شرح زیر تصویب گردید:» — and the sentence is what is signed. The
 * wording lives in the catalogue because it is the university's rather than this
 * program's, and `print.test.ts` holds it against the filed copies.
 *
 * ── (الف) lists its panel and (ب) does not ──────────────────────────────────
 *
 * The two sentences end differently on purpose. The proposal's ends «… به شرح
 * زیر تصویب گردید:» — *approved as follows*, which is what the seats beneath it
 * answer. The defence's ends «… به تصویب رسید.» and is complete; appending a
 * list to it would put a colon-less block under a closed sentence on a page the
 * council signs.
 */

export interface SentenceValues {
  thesisType: string;
  student: string;
  degree: string;
  field: string;
  thesis: string;
}

export interface MinutesWords {
  heading: string;
  subheading: string;
  /** The institution crest, stored as a validated PNG/JPEG data URI. */
  crest?: string;
  sectionA: string;
  sectionB: string;
  sectionC: string;
  sectionD: string;
  sectionDEmpty: string;
  letters: { a: string; b: string; c: string; d: string };
  present: string;
  absent: string;
  nobody: string;
  signature: string;
  researchDeputy: string;
  doctor: string;
  details: SittingLabels;
  /** The eight column headings of section (د), in order. */
  columns: string[];
  /** A seat's label — «استاد راهنمای اول». */
  seat: (key: string) => string;
  /** A vocabulary value in its own words, or «…» where nothing is recorded. */
  readable: (set: string | null, value: string | null) => string;
  /** Locale-aware separator for human-readable name lists. */
  separator: string;
  /** The stock sentence each section states its business in. */
  proposalSentence: (values: SentenceValues) => string;
  defenceSentence: (values: SentenceValues) => string;
  defenceWithInvited: (values: SentenceValues & { invited: string }) => string;
  standingIn: (person: string, member: string) => string;
  /** «پایان‌نامه» or «رساله», by the degree the case sits at. */
  thesisNoun: (educationLevel: string | null) => string;
}

/**
 * The seats a proposal appoints, in the order the minute states them.
 *
 * The first supervisor is stated even when the field is blank: a proposal
 * without one is an incomplete minute and the gap should be visible on the
 * page. The rest appear only when they were filled.
 */
const SEATS: { key: keyof SittingDecision; label: string; always?: boolean }[] = [
  { key: "primarySupervisor", label: "field.primarySupervisor", always: true },
  { key: "secondarySupervisor", label: "field.secondarySupervisor" },
  { key: "thirdSupervisor", label: "field.thirdSupervisor" },
  { key: "firstAdvisor", label: "field.firstAdvisor" },
  { key: "secondAdvisor", label: "field.secondAdvisor" },
  { key: "thirdAdvisor", label: "field.thirdAdvisor" },
  { key: "reviewer1", label: "field.reviewer1" },
  { key: "reviewer2", label: "field.reviewer2" },
  { key: "reviewer3", label: "field.reviewer3" },
  /* «داور مدعو» on this page, which is how the minute names the seat. */
  { key: "reviewer4Invited", label: "row.invitedReviewer" },
  { key: "graduateStudiesRepresentative", label: "field.graduateStudiesRepresentative" },
];

export function MinutesDocument({ papers, words }: { papers: SittingPapers; words: MinutesWords }) {
  const { meeting, sections, rulings, selections } = papers;

  const roll = attendance(
    meeting.participants ?? [],
    meeting.absentees ?? [],
    meeting.substitutions ?? {},
  );

  const named = (value: string | null) => withHonorific(value ?? "", words.doctor);

  const sentenceValues = (decision: SittingDecision): SentenceValues => ({
    thesisType: words.thesisNoun(decision.educationLevel),
    student: words.readable(null, decision.studentName),
    degree: words.readable("degrees", decision.educationLevel),
    field: words.readable("fields_of_study", decision.fieldOfStudy),
    thesis: words.readable(null, decision.thesisTitle),
  });

  return (
    <Sheet className="council-minutes-sheet">
      {/*
       * One heading, and the faculty belongs inside it.
       *
       * Version 1 heads this page «صورت‌جلسه شورای پژوهشی و تحصیلات تکمیلی
       * دانشکده دامپزشکی» — the council is named by the faculty whose council it
       * is, on one line. Two lines of letterhead above a heading with the
       * faculty cut out of it is a different document; with no institution
       * profile on file the heading is the council's name alone, which is what
       * version 1 prints when its own faculty name is missing.
       */}
      <header className="minutes-heading border-b-2 border-black/70 pb-3 text-center">
        {words.crest && (
          <div className="mb-2 flex justify-center">
            {/* The source is validated and stored by the institution profile. */}
            {/* biome-ignore lint/performance/noImgElement: validated data URI used in the printed document */}
            <img src={words.crest} alt="" className="size-16 object-contain" />
          </div>
        )}
        <h1 className="font-bold">{words.heading}</h1>
        <p className="mt-1 text-sm text-black/70">{words.subheading}</p>
      </header>

      <div className="minutes-details mt-3">
        <SittingDetails meeting={meeting} paper="minutes" labels={words.details} />
      </div>

      {/* Who chaired, who came and who did not. The chair's line carries a rule
          to sign on, because this block is the top of the signed page. */}
      <section className="minutes-attendance mt-3 rounded-sm border border-black/30 text-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-black/30 p-3 font-medium">
          <span>
            {words.researchDeputy}: {named(meeting.researchDeputy) || "…"}
          </span>
          {/*
           * A row of stops, not a ruled span. Version 1 prints «امضا:
           * ..............................» and the office signs across it; a
           * CSS border is invisible to anything reading the page as text, and
           * the two do not print the same width.
           */}
          <span className="font-normal text-black/60">
            {words.signature}: ..............................
          </span>
        </div>
        <div className="space-y-1 p-3 text-justify">
          <p>
            <span className="font-medium">{words.present}: </span>
            {roll.present.length > 0
              ? roll.present
                  .map((member) =>
                    member.standsFor
                      ? words.standingIn(named(member.name), named(member.standsFor))
                      : named(member.name),
                  )
                  .join(words.separator)
              : words.nobody}
          </p>
          <p>
            <span className="font-medium">{words.absent}: </span>
            {roll.absent.length > 0
              ? roll.absent.map((name) => named(name)).join(words.separator)
              : words.nobody}
          </p>
        </div>
      </section>

      {sections.proposals.length > 0 && (
        <section className="minutes-section mt-4">
          <SectionTitle letter={words.letters.a} title={words.sectionA} />
          <ol className="mt-2 space-y-2">
            {sections.proposals.map((decision) => (
              /*
               * `break-inside-avoid` on the item, not the section. Asking a
               * whole agenda to fit one sheet pushes a nearly-full sitting onto
               * the next one and leaves the first 40% empty; what must not be
               * split is a single resolution.
               */
              <li
                key={decision.id}
                className="minutes-resolution break-inside-avoid rounded-sm border border-black/25 bg-black/[0.03] p-3 text-justify text-sm leading-7"
              >
                <p>{words.proposalSentence(sentenceValues(decision))}</p>
                <ul className="mt-2 border-s-2 border-black/25 ps-3 text-sm">
                  {SEATS.filter((seat) => seat.always || isNamed(decision[seat.key])).map(
                    (seat) => (
                      <li key={seat.key} className="py-0.5">
                        <span className="font-medium">{words.seat(seat.label)}:</span>{" "}
                        {named(decision[seat.key] as string | null) || "…"}
                      </li>
                    ),
                  )}
                </ul>
              </li>
            ))}
          </ol>
        </section>
      )}

      {sections.defences.length > 0 && (
        <section className="minutes-section mt-4">
          <SectionTitle letter={words.letters.b} title={words.sectionB} />
          <ol className="mt-2 space-y-2">
            {sections.defences.map((decision) => {
              const values = sentenceValues(decision);
              return (
                <li
                  key={decision.id}
                  className="minutes-resolution break-inside-avoid rounded-sm border border-black/25 bg-black/[0.03] p-3 text-justify text-sm leading-7"
                >
                  <p>
                    {isNamed(decision.reviewer4Invited)
                      ? words.defenceWithInvited({
                          ...values,
                          invited: named(decision.reviewer4Invited),
                        })
                      : words.defenceSentence(values)}
                  </p>
                </li>
              );
            })}
          </ol>
        </section>
      )}

      {rulings.length > 0 && (
        <section className="minutes-section mt-4">
          <SectionTitle letter={words.letters.c} title={words.sectionC} />
          <ol className="mt-2 space-y-2">
            {rulings.map((ruling) => (
              <li
                key={ruling.id}
                className="minutes-resolution break-inside-avoid rounded-sm border border-black/25 bg-black/[0.03] p-3 text-justify text-sm leading-7"
              >
                {/* The minute carries the resolution whole, verb of approval
                    included — unlike the checklist, which is read before the
                    vote and has it stripped. */}
                <p>{normalizeSpacing(ruling.decisionText ?? "")}</p>
                {ruling.decisionDescription?.trim() && (
                  <p className="mt-1.5 text-xs text-black/70">
                    {ruling.decisionDescription.trim()}
                  </p>
                )}
              </li>
            ))}
          </ol>
        </section>
      )}

      {/* Section (د) prints even when empty: the council records that it took no
          appointments as deliberately as it records that it took some. */}
      <section className="minutes-section minutes-appointments mt-4 break-inside-avoid">
        <SectionTitle letter={words.letters.d} title={words.sectionD} />
        {selections.length === 0 ? (
          <p className="py-4 text-center text-sm italic text-black/50">{words.sectionDEmpty}</p>
        ) : (
          <div className="minutes-table-wrap mt-2 overflow-x-auto">
            <table className="minutes-table w-full border border-black/40 text-xs">
              <thead>
                <tr className="bg-black/[0.06]">
                  {words.columns.map((column) => (
                    <th
                      scope="col"
                      key={column}
                      className="border border-black/40 p-1.5 text-start font-medium"
                    >
                      {column}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {selections.map((selection, index) => (
                  <tr key={selection.id}>
                    <td className="border border-black/40 p-1.5 tabular-nums">{index + 1}</td>
                    <td className="border border-black/40 p-1.5">
                      {selection.studentName?.trim() || "…"}
                    </td>
                    <td className="border border-black/40 p-1.5 tabular-nums">
                      {selection.studentNumber || "…"}
                    </td>
                    <td className="border border-black/40 p-1.5">
                      {words.readable("degrees", selection.educationLevel)}
                    </td>
                    <td className="border border-black/40 p-1.5">
                      {words.readable("fields_of_study", selection.fieldOfStudy)}
                    </td>
                    {[0, 1, 2].map((seat) => (
                      /* «-» for a seat nobody was appointed to, which is what
                         version 1 rules in an empty supervision cell. */
                      <td key={seat} className="border border-black/40 p-1.5">
                        {selection.supervisors[seat]
                          ? named(selection.supervisors[seat] ?? null)
                          : "-"}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </Sheet>
  );
}
