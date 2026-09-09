import { describe, expect, it } from "vitest";
import en from "@/messages/en.json" with { type: "json" };
import fa from "@/messages/fa.json" with { type: "json" };
import { type AttentionInput, attentionFailed, attentionSignals, raisedSignals } from "./rules.ts";
import { STALE_REVIEW_DAYS } from "./vocabulary.ts";

/**
 * The ranking, against a table of numbers.
 *
 * These rules are pure and take counts precisely so they can be tested this
 * way: no database, no clock, no translation. What is being asserted is the
 * judgement — which signals interrupt somebody, which merely appear on a list,
 * and in what order — because that judgement is the whole value of the feature
 * and it is invisible in the types.
 */

/** Nothing outstanding anywhere, and everything answered. */
function quiet(): AttentionInput {
  return {
    council: {
      entitled: true,
      ready: true,
      pendingTotal: 0,
      oldestMeeting: null,
      oldestDays: null,
      defencesSoon: 0,
      defencesIncomplete: 0,
      sittingsSoon: 0,
    },
    students: { entitled: true, ready: true, unsupervised: 0, masters: 0 },
    workshops: { entitled: true, ready: true, withoutInstructor: 0 },
    calendar: { entitled: true, ready: true, upcoming: 0, nextTitle: null },
    institution: { entitled: true, unnamed: false },
  };
}

describe("what earns an interruption", () => {
  it("raises nothing when there is nothing to do", () => {
    const signals = attentionSignals(quiet());
    expect(signals.length).toBeGreaterThan(0);
    expect(raisedSignals(signals)).toEqual([]);
    /* Every count answered, so every rule is green rather than grey. */
    expect(signals.every((signal) => signal.tone === "success")).toBe(true);
  });

  it("raises an incomplete defence file above everything else", () => {
    const input = quiet();
    input.council.defencesIncomplete = 2;
    input.council.sittingsSoon = 1;
    input.workshops.withoutInstructor = 1;

    const raised = raisedSignals(attentionSignals(input));
    expect(raised[0]?.id).toBe("defence-dossier");
    /* A defence that cannot legally proceed outranks a sitting next week. */
    expect(raised.map((signal) => signal.id)).toEqual([
      "defence-dossier",
      "workshop-instructor",
      "sitting-soon",
    ]);
  });

  it("escalates a review backlog only once it has gone stale", () => {
    const fresh = quiet();
    fresh.council.pendingTotal = 11;
    fresh.council.oldestDays = STALE_REVIEW_DAYS;

    const stale = quiet();
    stale.council.pendingTotal = 2;
    stale.council.oldestDays = STALE_REVIEW_DAYS + 1;

    /*
     * A queue of eleven all filed last week is the council working. A queue of
     * two whose oldest has waited past a month is a decision nobody owns, and
     * it is the second one that interrupts somebody — even though it is the
     * smaller number.
     */
    expect(raisedSignals(attentionSignals(fresh))).toEqual([]);
    expect(raisedSignals(attentionSignals(stale)).map((s) => s.id)).toEqual(["pending-review"]);

    const staleSignal = attentionSignals(stale).find((s) => s.id === "pending-review");
    const freshSignal = attentionSignals(fresh).find((s) => s.id === "pending-review");
    expect(staleSignal?.tone).toBe("danger");
    expect(freshSignal?.tone).toBe("warning");
    /* And it moves up the list rather than only changing colour. */
    expect(staleSignal?.rank).toBeLessThan(freshSignal?.rank ?? 0);
  });

  it("lists a standing figure without ever raising it", () => {
    const input = quiet();
    input.students.unsupervised = 54;

    const signals = attentionSignals(input);
    const unsupervised = signals.find((signal) => signal.id === "unsupervised");

    /*
     * The rule this file exists to enforce: a number that no single morning's
     * work moves belongs on a panel somebody opens, never on a badge. Fifty-four
     * is a large number and it still does not light the bell.
     */
    expect(unsupervised?.count).toBe(54);
    expect(unsupervised?.raised).toBe(false);
    expect(raisedSignals(signals)).toEqual([]);
  });

  it("never raises, and never greens, a count that did not answer", () => {
    const input = quiet();
    input.council.ready = false;
    input.council.defencesIncomplete = 0;

    const signals = attentionSignals(input);
    const council = signals.filter((signal) => signal.id.startsWith("defence"));

    /*
     * Nought and «not counted» are the same number and opposite claims. The
     * failure this forbids is a refused read rendering as a clean bill of
     * health.
     */
    expect(council.every((signal) => signal.tone === "neutral")).toBe(true);
    expect(council.every((signal) => !signal.raised)).toBe(true);
    expect(attentionFailed(signals)).toBe(true);
  });

  it("says nothing at all about a register the reader may not open", () => {
    /* `quiet()` already omits capacity — the shell never computes it. */
    const input = quiet();
    input.students.entitled = false;
    input.students.unsupervised = 54;

    const ids = attentionSignals(input).map((signal) => signal.id);
    /* Absent, not present and empty: somebody without `students.view` is shown
       a list that never mentions students, not a figure greyed out. */
    expect(ids).not.toContain("unsupervised");
    expect(ids).not.toContain("over-capacity");
  });

  it("orders every signal by urgency", () => {
    const ranks = attentionSignals(quiet()).map((signal) => signal.rank);
    expect(ranks).toEqual([...ranks].sort((left, right) => left - right));
  });
});

describe("the wording each signal names", () => {
  /*
   * Every label and hint a rule can produce, in both catalogues. A rule whose
   * key is missing throws at render — inside the shell, so on every page — and
   * next-intl reports a miss by returning the path, which would put
   * «attention.defenceDossier» on the bell in a column of Persian.
   */
  const everyShape: AttentionInput[] = [
    quiet(),
    (() => {
      const input = quiet();
      input.council.oldestMeeting = "۶۸۰";
      input.council.oldestDays = 40;
      input.students.masters = 3;
      input.calendar.nextTitle = "بازدید هیئت ممیزه";
      input.capacity = { entitled: true, ready: true, over: 2, missingInputs: 0 };
      return input;
    })(),
    (() => {
      const input = quiet();
      input.institution.unnamed = true;
      input.capacity = { entitled: true, ready: true, over: 0, missingInputs: 4 };
      return input;
    })(),
  ];

  const catalogues = { fa, en } as Record<string, { attention: Record<string, string> }>;

  for (const language of ["fa", "en"]) {
    it(`resolves every key in the ${language} catalogue`, () => {
      const said = catalogues[language]?.attention ?? {};
      const missing: string[] = [];

      for (const input of everyShape) {
        for (const signal of attentionSignals(input)) {
          if (typeof said[signal.labelKey] !== "string") missing.push(signal.labelKey);
          if (signal.hint && typeof said[signal.hint.key] !== "string") {
            missing.push(signal.hint.key);
          }
        }
      }

      expect([...new Set(missing)]).toEqual([]);
    });

    it(`fills every placeholder in the ${language} catalogue`, () => {
      /*
       * A message with `{days}` in it and no `days` in its values renders the
       * brace literally — next-intl does not throw for a missing argument, it
       * prints it. The values are declared beside the key in the rule, so the
       * two can be checked against each other here.
       */
      const said = catalogues[language]?.attention ?? {};
      const unfilled: string[] = [];

      for (const input of everyShape) {
        for (const signal of attentionSignals(input)) {
          for (const [key, values] of [
            [signal.labelKey, {}] as const,
            ...(signal.hint ? [[signal.hint.key, signal.hint.values] as const] : []),
          ]) {
            const message = said[key];
            if (typeof message !== "string") continue;
            for (const match of message.matchAll(/\{(\w+)/g)) {
              const name = match[1];
              if (name && !(name in values)) unfilled.push(`${key}: {${name}}`);
            }
          }
        }
      }

      expect([...new Set(unfilled)]).toEqual([]);
    });
  }
});
