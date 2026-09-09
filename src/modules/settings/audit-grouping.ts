import type { AuditEntry } from "./audit.ts";

/**
 * A run of identical changes, folded into one line.
 *
 * ── The volume problem, and why it is solved here ───────────────────────────
 *
 * Every row of the trail is precise: one record, one field, from what, to what.
 * That is what makes it worth reading and also what makes a bulk edit
 * unreadable. Setting the standing of 500 students writes 500 correct rows
 * saying the same sentence about 500 different people, and they push a year of
 * real history off the screen.
 *
 * Neither obvious fix is acceptable. Dropping the per-record rows loses exactly
 * the precision that was the point, and one summary row saying «۵۰۰ رکورد
 * تغییر کرد» is the coarse trail this replaced.
 *
 * So every row stays and the *screen* folds them.
 *
 * ── Why not a batch id written by the server ────────────────────────────────
 *
 * A bulk edit here is one Server Action that writes N audit rows in one
 * transaction, so a batch id *could* be stamped. It is still the wrong place:
 * the id would have to be added to the table, to every write site that might
 * one day want it, and to the import — and it would be missing from every row
 * already written, which is the entire archive this screen exists to read.
 * Deriving it at read time has no state to get wrong and works on rows written
 * before anybody thought of it.
 *
 * ── What it will not do ─────────────────────────────────────────────────────
 *
 * A run split across a page boundary shows as two groups. That is honest — the
 * page is what the reader is looking at — and the search box is there for
 * following one record through the whole trail.
 */
export interface AuditGroup {
  /** The newest event of the run; what the folded line is drawn from. */
  lead: AuditEntry;
  /** Every event in the run, newest first. One element when nothing folded. */
  members: AuditEntry[];
}

/**
 * Runs shorter than this stay as ordinary rows.
 *
 * Two lines are not a volume problem, and folding them costs the reader a click
 * to see what they could already read. Three is where a list starts to look
 * like somebody ran an operation rather than made an edit.
 */
export const MIN_GROUP = 3;

/**
 * What makes two events «the same change».
 *
 * The actor, what they did, to what kind of record, and — for an edit — the
 * exact set of fields and the exact values they moved between. A bulk edit
 * satisfies all of it by construction: one operator, one action, one table, one
 * new value. Two people who happen to make the same correction do not, and
 * neither do two corrections that set different values.
 *
 * `null` for anything that must never fold: an event with no record is a
 * one-off — an import, an export, a sign-in — and folding those would put two
 * unrelated administrative acts behind one disclosure triangle.
 */
function signatureOf(entry: AuditEntry): string | null {
  if (!entry.entityType || !entry.entityId) return null;

  /*
   * One JSON array rather than four fields glued together.
   *
   * A glued key needs a separator, and every separator is a character some
   * actor name or field value may contain — at which point two different
   * events produce one key and the screen folds two things that are not the
   * same change. Serialising the parts keeps their boundaries without inventing
   * one.
   *
   * The changes are ordered before serialising, because `readChanges` walks an
   * object and two rows written by the same action can still arrive with their
   * keys in a different order. Sorting makes «the same change» mean what it
   * says rather than «the same change, written the same way».
   */
  const changes = [...entry.changes]
    .sort((left, right) => left.field.localeCompare(right.field))
    .map((change) => [change.field, change.from ?? null, change.to ?? null]);

  return JSON.stringify([entry.actorId ?? "", entry.action, entry.entityType, changes]);
}

/**
 * Folds contiguous runs of the same change into groups.
 *
 * Contiguity is required, not incidental. The list arrives newest-first, so a
 * bulk edit's rows sit together; two identical corrections a month apart do not
 * and must not be drawn as one operation just because they match.
 */
export function groupAuditEntries(entries: readonly AuditEntry[]): AuditGroup[] {
  const groups: AuditGroup[] = [];
  let run: AuditEntry[] = [];
  let runKey: string | null = null;

  const flush = () => {
    if (run.length === 0) return;
    if (run.length >= MIN_GROUP) {
      const [lead] = run;
      if (lead) groups.push({ lead, members: run });
    } else {
      for (const entry of run) groups.push({ lead: entry, members: [entry] });
    }
    run = [];
  };

  for (const entry of entries) {
    const key = signatureOf(entry);
    if (key !== null && key === runKey) {
      run.push(entry);
      continue;
    }
    flush();
    runKey = key;
    run = [entry];
  }
  flush();
  return groups;
}

/**
 * Actions worth colouring, because they change what somebody may do — or,
 * in one case, because a copy of the register left the building.
 *
 * Deliberately short. A log where a third of the lines are amber is a log where
 * the amber means nothing, so this holds only what an auditor would want to be
 * stopped by while scrolling.
 */
export const NOTABLE: ReadonlySet<string> = new Set([
  "users.suspend",
  "users.revoke",
  "users.roles.assign",
  "users.password.reset",
  "users.mfa.reset",
  "tenant.owner.transferred",
  "data.export",
]);

/**
 * Where an event's record can be opened, for the kinds that have a page.
 *
 * Both spellings of each register appear because the hand-written events use
 * the singular (`student`) while anything writing a table key uses the plural;
 * the trail carries both. Everything else — roles, lookups, an institution
 * profile — has no record page, and its id stays plain text, because a link
 * that opens nothing is worse than no link.
 */
export const ENTITY_PATH: Record<string, (id: string) => string> = {
  student: (id) => `/students/${id}`,
  students: (id) => `/students/${id}`,
  professor: (id) => `/professors/${id}`,
  professors: (id) => `/professors/${id}`,
  council_meeting: (id) => `/council-meetings/${id}`,
  council_meetings: (id) => `/council-meetings/${id}`,
  council_decision: (id) => `/council-decisions/${id}`,
  council_decisions: (id) => `/council-decisions/${id}`,
  council_ruling: (id) => `/council-decisions/rulings/${id}`,
  council_appointment: (id) => `/council-decisions/appointments/${id}`,
  workshop: (id) => `/workshops/${id}`,
  workshops: (id) => `/workshops/${id}`,
};
