/**
 * The words every attention rule is written in, and nothing that decides.
 *
 * Split from the rules themselves so the two families of rule — the council's
 * and the office's — can both import the tone ladder, the routes and the
 * horizons without importing each other. A vocabulary nobody imports *from* has
 * no cycle to worry about, and it is the honest shape: these are terms, not
 * judgements.
 */

export type AttentionTone = "neutral" | "warning" | "danger" | "success";

export interface AttentionHint {
  /** A catalogue key under `attention.*`, said where the signal is drawn. */
  key: string;
  values: Record<string, string | number>;
}

/**
 * Which icon draws the row.
 *
 * A name rather than the component itself, because these signals are computed
 * on the server and handed to a client island: a React component cannot cross
 * that boundary as a prop. The island maps the name back — see `ALERT_ICONS`.
 */
export type AttentionIcon =
  | "fileWarning"
  | "calendarClock"
  | "calendarDays"
  | "clipboardList"
  | "building"
  | "presentation"
  | "stickyNote"
  | "userX"
  | "users"
  | "gauge";

export interface AttentionSignal {
  /** Stable across renders and across both surfaces that draw it. */
  id: string;
  href: string;
  icon: AttentionIcon;
  /** Catalogue key for the row's title. */
  labelKey: string;
  /** Catalogue key and values for the line under it, when there is one. */
  hint: AttentionHint | null;
  /**
   * Whether `count` is an answer rather than a query that has not returned.
   *
   * Nought and «not counted yet» are the same number and opposite claims. A
   * signal that is not ready is never raised on the bell and never coloured
   * green on the panel — which is what stops a refused read from rendering as
   * «nothing needs you».
   */
  ready: boolean;
  count: number;
  tone: AttentionTone;
  /** Sort key; lower is more urgent. */
  rank: number;
  /** Whether this belongs in front of somebody right now. */
  raised: boolean;
}

/** How far ahead a defence has to be before it stops being this week's problem. */
export const DEFENCE_HORIZON_DAYS = 7;

/**
 * How far ahead the dossier is checked.
 *
 * Longer than the defence horizon on purpose. Chasing a missing similarity
 * certificate takes days, so a warning that arrived with the defence would
 * arrive too late to act on; a warning two weeks out is one somebody can
 * actually close.
 */
export const DOSSIER_HORIZON_DAYS = 14;

/** The sitting horizon, matching the fortnightly rhythm the council keeps. */
export const SITTING_HORIZON_DAYS = 7;

/** How long a workshop has to prepare once it has no instructor named. */
export const WORKSHOP_HORIZON_DAYS = 14;

/**
 * How far ahead the office's own diary is read.
 *
 * Shorter than every other horizon here, deliberately. The others are this
 * file's guess at how long a piece of work takes to arrange; this one is a note
 * somebody wrote against a day *because they wanted telling*, and a reminder
 * that starts a fortnight early is a reminder that has gone off eleven times
 * before the day arrives.
 */
export const CALENDAR_HORIZON_DAYS = 7;

/**
 * When a review backlog stops being a queue and becomes a problem.
 *
 * The council sits about every fortnight, so a decision still unreviewed after
 * a month has missed two of them. Below that the queue is working; above it,
 * something is stuck.
 */
export const STALE_REVIEW_DAYS = 30;

/** Where each signal sends the reader. Kept beside the rules that use it. */
export const ATTENTION_ROUTE = {
  decisions: "/council-decisions",
  meetings: "/council-meetings",
  students: "/students",
  capacity: "/professor-capacity",
  workshops: "/workshops",
  calendar: "/calendar",
  institution: "/settings/institution",
} as const;

/**
 * The tone a count earns.
 *
 * `ready` first and unconditionally: an unanswered query is neutral, never
 * green. Green is a claim.
 */
export function toneFor(
  ready: boolean,
  count: number,
  alarm: Exclude<AttentionTone, "neutral">,
): AttentionTone {
  if (!ready) return "neutral";
  return count > 0 ? alarm : "success";
}
