import {
  ATTENTION_ROUTE,
  type AttentionSignal,
  CALENDAR_HORIZON_DAYS,
  DEFENCE_HORIZON_DAYS,
  DOSSIER_HORIZON_DAYS,
  SITTING_HORIZON_DAYS,
  STALE_REVIEW_DAYS,
  toneFor,
  WORKSHOP_HORIZON_DAYS,
} from "./vocabulary.ts";

/**
 * What earns an interruption, and what merely earns a row.
 *
 * ── The two tests a rule has to pass ────────────────────────────────────────
 *
 * *Can somebody act on it today?* A signal naming a season's problem is a
 * signal that is true every morning, and a bell that is lit every morning is a
 * bell nobody reads.
 *
 * *Does it clear itself?* A rule that stays true after the work is done teaches
 * people to ignore it. Every rule below is either time-bounded — it leaves its
 * window on its own — or clears the moment the record is corrected. That is
 * also why none of them can be dismissed: there is nothing to dismiss that the
 * work does not remove, and a mute button would let a signal be silenced while
 * the fact behind it stood.
 *
 * ── Badged, or merely listed ────────────────────────────────────────────────
 *
 * `raised` is the narrower claim: it is what lights the bell. A signal can be
 * worth a row on a panel somebody opened on purpose and not worth interrupting
 * anybody over — a standing figure, a correction backlog, a supervision load
 * that no morning's work moves. Those are listed and not raised, and the
 * distinction is deliberate enough that adding a rule which *badges* is the
 * decision needing the argument, not adding one that does not.
 *
 * The functions here are pure and take counts. They do no reading and no
 * translation, so the ranking can be tested against a table of numbers.
 */

export interface CouncilAttention {
  entitled: boolean;
  ready: boolean;
  pendingTotal: number;
  oldestMeeting: string | null;
  oldestDays: number | null;
  defencesSoon: number;
  defencesIncomplete: number;
  sittingsSoon: number;
}

export interface StudentsAttention {
  entitled: boolean;
  ready: boolean;
  unsupervised: number;
  masters: number;
}

export interface CapacityAttention {
  entitled: boolean;
  ready: boolean;
  over: number;
  /** Professors with no allowance recorded, so the figure is not yet settled. */
  missingInputs: number;
}

export interface WorkshopsAttention {
  entitled: boolean;
  ready: boolean;
  withoutInstructor: number;
}

export interface CalendarAttention {
  entitled: boolean;
  ready: boolean;
  upcoming: number;
  nextTitle: string | null;
}

export interface InstitutionAttention {
  entitled: boolean;
  unnamed: boolean;
}

export interface AttentionInput {
  council: CouncilAttention;
  students: StudentsAttention;
  workshops: WorkshopsAttention;
  calendar: CalendarAttention;
  institution: InstitutionAttention;
  /*
   * Optional, and absent from the shell's own read.
   *
   * A supervision overrun is not a count but a comparison of every professor's
   * load against a quota set per year — three unpivoted seat columns, weighted
   * and grouped. That is far too heavy to run on every page load for a signal
   * that is never raised on the bell, so the shell omits it and the panel that
   * shows it supplies it from the capacity module it was already reading.
   */
  capacity?: CapacityAttention;
}

/** Everything the council's minutes contribute, most urgent first. */
function councilSignals(council: CouncilAttention): AttentionSignal[] {
  if (!council.entitled) return [];

  const signals: AttentionSignal[] = [
    /*
     * First, and the only council rule about a document rather than a date. A
     * defence with no permit form, no thesis file or no similarity certificate
     * on file is a defence that cannot legally go ahead, and the council learns
     * this on the day unless something says so first. It is the «missing what
     * its next step requires» case narrowed to the people whose next step is a
     * fortnight away — which is what makes it actionable and what makes it
     * clear itself.
     */
    {
      id: "defence-dossier",
      href: ATTENTION_ROUTE.decisions,
      icon: "fileWarning",
      labelKey: "defenceDossier",
      hint: { key: "defenceDossierHint", values: { days: DOSSIER_HORIZON_DAYS } },
      ready: council.ready,
      count: council.defencesIncomplete,
      tone: toneFor(council.ready, council.defencesIncomplete, "danger"),
      rank: 10,
      raised: council.ready && council.defencesIncomplete > 0,
    },
    {
      id: "defence-soon",
      href: ATTENTION_ROUTE.decisions,
      icon: "calendarClock",
      labelKey: "defenceSoon",
      hint: { key: "defenceSoonHint", values: { days: DEFENCE_HORIZON_DAYS } },
      ready: council.ready,
      count: council.defencesSoon,
      tone: toneFor(council.ready, council.defencesSoon, "warning"),
      rank: 30,
      /*
       * A defence next week is news the first time and wallpaper the fifth, so
       * it is deliberately the mildest thing on the bell — present because the
       * office asked to be told, ranked below the two rules that name something
       * broken.
       */
      raised: council.ready && council.defencesSoon > 0,
    },
    {
      id: "sitting-soon",
      href: ATTENTION_ROUTE.meetings,
      icon: "calendarDays",
      labelKey: "sittingSoon",
      hint: { key: "sittingSoonHint", values: { days: SITTING_HORIZON_DAYS } },
      ready: council.ready,
      count: council.sittingsSoon,
      tone: toneFor(council.ready, council.sittingsSoon, "warning"),
      rank: 40,
      raised: council.ready && council.sittingsSoon > 0,
    },
  ];

  /*
   * The backlog escalates rather than existing in two states. A queue of eleven
   * all filed last week is the council working; a queue of two whose oldest has
   * waited eleven weeks is a decision nobody owns, and the second is the one
   * worth interrupting somebody over.
   */
  const stale = council.oldestDays !== null && council.oldestDays > STALE_REVIEW_DAYS;
  signals.push({
    id: "pending-review",
    href: ATTENTION_ROUTE.decisions,
    icon: "clipboardList",
    labelKey: "pendingReview",
    hint:
      council.oldestMeeting !== null && council.oldestDays !== null
        ? {
            key: "oldestPending",
            values: { meeting: council.oldestMeeting, days: council.oldestDays },
          }
        : null,
    ready: council.ready,
    count: council.pendingTotal,
    tone: toneFor(council.ready, council.pendingTotal, stale ? "danger" : "warning"),
    rank: stale ? 25 : 50,
    raised: council.ready && council.pendingTotal > 0 && stale,
  });

  return signals;
}

/** Everything that needs the office and does not come out of the minutes. */
function officeSignals(input: AttentionInput): AttentionSignal[] {
  const { institution, workshops, calendar, students, capacity } = input;
  const signals: AttentionSignal[] = [];

  if (institution.entitled) {
    /*
     * Official instruments are withheld until the institution identity is
     * complete. One profile edit clears the blocking condition everywhere.
     */
    signals.push({
      id: "institution-unnamed",
      href: ATTENTION_ROUTE.institution,
      icon: "building",
      labelKey: "institutionUnnamed",
      hint: { key: "institutionUnnamedHint", values: {} },
      ready: true,
      count: institution.unnamed ? 1 : 0,
      tone: institution.unnamed ? "danger" : "success",
      rank: 15,
      raised: institution.unnamed,
    });
  }

  if (workshops.entitled) {
    /*
     * A workshop with a date, a venue and nobody to teach it. Blocking, fixable
     * in one edit, and gone from this list the moment an instructor is named or
     * the date passes.
     *
     * The sibling rule considered and rejected: «a workshop with unfilled
     * seats». It is true for every workshop from the day it is created until
     * the day it runs, nobody can close it by doing anything in this
     * application, and it would fire every morning for the same fact — which is
     * the shape this file exists to exclude.
     */
    signals.push({
      id: "workshop-instructor",
      href: ATTENTION_ROUTE.workshops,
      icon: "presentation",
      labelKey: "workshopInstructor",
      hint: { key: "workshopInstructorHint", values: { days: WORKSHOP_HORIZON_DAYS } },
      ready: workshops.ready,
      count: workshops.withoutInstructor,
      tone: toneFor(workshops.ready, workshops.withoutInstructor, "danger"),
      rank: 20,
      raised: workshops.ready && workshops.withoutInstructor > 0,
    });
  }

  if (calendar.entitled) {
    /*
     * The office's own diary, and the only rule here nobody had to infer.
     *
     * Every other signal is this file's guess at what a register implies. This
     * one is a person having written «بازدید هیئت ممیزه» against next Tuesday
     * *because they wanted telling* — which is what a notification is.
     *
     * Only `calendar_entries`. The screen also draws sittings, defences and
     * workshops projected out of the registers that own them, and all three are
     * already carried above; counting them here would put the same council
     * sitting on the bell twice under two names.
     *
     * Raised, unlike almost everything else that is not broken, because a
     * reminder that does not interrupt is a note in a book nobody opens. It
     * leaves the window on its own when the day passes, so it cannot become
     * wallpaper the way a standing figure does.
     */
    signals.push({
      id: "office-note",
      href: ATTENTION_ROUTE.calendar,
      icon: "stickyNote",
      labelKey: "officeNote",
      hint:
        calendar.nextTitle !== null
          ? { key: "officeNoteNext", values: { title: calendar.nextTitle } }
          : { key: "officeNoteHint", values: { days: CALENDAR_HORIZON_DAYS } },
      ready: calendar.ready,
      count: calendar.upcoming,
      tone: toneFor(calendar.ready, calendar.upcoming, "warning"),
      rank: 45,
      raised: calendar.ready && calendar.upcoming > 0,
    });
  }

  if (students.entitled) {
    signals.push({
      id: "unsupervised",
      href: ATTENTION_ROUTE.students,
      icon: "userX",
      labelKey: "unsupervised",
      hint:
        students.masters > 0
          ? { key: "unsupervisedMasters", values: { count: students.masters } }
          : null,
      ready: students.ready,
      count: students.unsupervised,
      tone: toneFor(students.ready, students.unsupervised, "danger"),
      rank: 60,
      /*
       * Not raised on the bell, and present on the panel.
       *
       * A standing figure that no single morning's work moves: the number that
       * leaves it each week is the number a new intake puts back. Exactly the
       * «fires every day for the same fact» shape, so it stays a number on a
       * panel somebody opens on purpose rather than a badge that never goes
       * out.
       */
      raised: false,
    });
  }

  if (capacity?.entitled) {
    signals.push({
      id: "over-capacity",
      href: ATTENTION_ROUTE.capacity,
      icon: "gauge",
      labelKey: "overCapacity",
      hint:
        capacity.missingInputs > 0
          ? { key: "capacityProvisional", values: { count: capacity.missingInputs } }
          : { key: "capacitySettled", values: {} },
      ready: capacity.ready,
      count: capacity.over,
      /*
       * Provisional while any professor has no allowance recorded: the figure
       * is then a question the office cannot yet answer rather than a finding,
       * and colouring a question red is how a panel comes to be disbelieved.
       */
      tone:
        capacity.missingInputs > 0 ? "neutral" : toneFor(capacity.ready, capacity.over, "warning"),
      rank: 70,
      /*
       * Never on the bell. Two reasons, either sufficient: a supervision load
       * is a season's problem and nothing done this morning takes a student off
       * a supervisor; and while the figure is provisional it is not a finding
       * at all.
       */
      raised: false,
    });
  }

  return signals;
}

/**
 * Every signal this office is entitled to see, most urgent first.
 *
 * Signals the reader may not act on are absent rather than empty: somebody
 * without `capacity.view` is not shown a supervision figure greyed out, they
 * are shown a list that never mentions supervision.
 */
export function attentionSignals(input: AttentionInput): AttentionSignal[] {
  return [...councilSignals(input.council), ...officeSignals(input)].sort(
    (left, right) => left.rank - right.rank,
  );
}

/** What lights the bell: raised, and carrying a count. */
export function raisedSignals(signals: readonly AttentionSignal[]): AttentionSignal[] {
  return signals.filter((signal) => signal.raised && signal.count > 0);
}

/**
 * Whether any signal failed to answer.
 *
 * Reported separately so a surface can say «some of this could not be counted»
 * rather than presenting a short list as a complete one.
 */
export function attentionFailed(signals: readonly AttentionSignal[]): boolean {
  return signals.some((signal) => !signal.ready);
}
