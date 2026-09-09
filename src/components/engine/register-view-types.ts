import type { StatusTone } from "./tones.ts";

export interface RegisterColumn {
  key: string;
  header: string;
  /** Absent when SQL has no meaningful order for the column. */
  sortHref?: string;
  /** Logical sort key; enables additive Shift+click multi-sort without changing the no-JS link. */
  sortKey?: string;
  /** Direction encoded by `sortHref`. */
  nextSortDirection?: "asc" | "desc";
  sortActive?: boolean;
  sortDirection?: "asc" | "desc";
  sortActionLabel?: string;
  /**
   * A column the picker will not let anybody hide.
   *
   * One column per register carries the identity of the row — the person's
   * name, the sitting's number — and hiding it leaves a table of attributes
   * belonging to nobody: ten rows of «دانشیار / مهندسی / ۴۰۰۱» that cannot be
   * read, cannot be reported and give no clue how to get the names back except
   * to find the picker again.
   *
   * Drawn in the list and ticked, rather than left out of it: an absent entry
   * reads as a column this register does not have.
   */
  locked?: boolean;
  /**
   * A ceiling on how wide this column's content may grow — `max-w-64`.
   *
   * A table cell sizes to its content, so one column of free text — a list of
   * attendees, a note — widens the whole table until the columns after it are
   * off the side of the screen. On the sittings register that pushed «مصوبات»,
   * the most useful column on the row, behind a horizontal scrollbar.
   *
   * A `max-width` on the cell's *content*, not a `width` on the column header:
   * under the browser's automatic table layout a header width is only a hint
   * that content overrules, whereas a bounded box makes the clamping inside it
   * actually happen. Given only to the columns that would otherwise run away —
   * the rest are left to the browser, which shares out what is left better than
   * a full set of hand-picked widths would.
   */
  width?: string;
  /** Initial pixel width for the resizable register layout. Browser overrides are persisted per route. */
  defaultWidth?: number;
}

/**
 * A figure that means something, with the names behind it underneath.
 *
 * Attendance is the case this exists for: «۴ حاضر» over the first two names,
 * «۱ غایب» over theirs. The count alone sends the reader into the record to
 * find out who, and the names alone have to be counted by eye.
 */
export interface RegisterBadge {
  text: string;
  tone: StatusTone;
  /** The quiet line under the badge — usually the names it counted. */
  caption?: string | null;
}

export interface RegisterCell {
  text: string | null;
  /** A second, quieter line under the first — a national id, a field of study. */
  secondary?: string | null;
  /** Draw as a vocabulary chip in this tone. */
  tone?: number;
  /** Draw as a state chip: present, absent, has business, has none. */
  statusTone?: StatusTone;
  /** Stacked state chips, each with its own caption. Wins over `text`. */
  badges?: RegisterBadge[];
  /**
   * A panel of names, one per line.
   *
   * Three supervisors are three people and not one with two footnotes: folded
   * into a `secondary` line the third disappears, and a reader counting a
   * panel has to guess whether the cell was truncated. Empty entries are
   * dropped, so a case with one supervisor shows one line.
   */
  list?: (string | null)[];
  /**
   * One member of that panel who holds a different office.
   *
   * The graduate-studies representative sits with the reviewers but is not an
   * examiner like them. Said in words as well as marked, because colour alone
   * is invisible in greyscale — and this cell prints.
   */
  distinct?: { name: string | null; label: string } | null;
  /** Lay the cell out left-to-right: identifiers and figures. */
  ltr?: boolean;
  /**
   * Say it quietly, in the small voice.
   *
   * «بدون مصوبه» is not a value, it is the absence of one, and drawing it in
   * the cell's ordinary weight makes an empty sitting look as substantial as a
   * busy one.
   */
  muted?: boolean;
  /** Clamp to two lines — free text in a table column, such as notes. */
  clamp?: boolean;
  /**
   * A gender marker before the text, on the two name columns.
   *
   * Persian names do not carry gender the way many European ones do, and the
   * office addresses a student as «خانم» or «آقای» on every letter it sends
   * them — so the register shows it where the name is, rather than making
   * somebody open the record to find out how to write to them. It is a glyph
   * and not a word because it sits in a column of names and a fourth word per
   * row would crowd them.
   *
   * Absent where nothing is recorded, and a neutral figure is drawn instead: a
   * blank would read as a column that sometimes has an icon for no reason.
   */
  gender?: { value: string | null; label: string | null };
}

export interface RegisterViewRow {
  id: string;
  /** Record destination. Historical rows may deliberately have no live detail route. */
  href?: string;
  /** Edit destination; omitted for immutable/historical rows. */
  editHref?: string;
  /**
   * How this row is named when it is about to be deleted.
   *
   * The confirmation says «حذف پرونده‌ی مریم رضایی», not «حذف ۱ رکورد» — a
   * count of one tells the reader nothing they can check the click against,
   * and the row under the cursor is not always the row they meant.
   */
  label?: string;
  /**
   * The row's optimistic-concurrency version, when its register supplies one.
   *
   * A register whose rows carry it is a register whose bulk edits can honour
   * the promise a single-record save makes: a record edited between ticking
   * and applying is skipped, not overwritten. Absent where no bulk edit
   * exists — there is nothing for the version to protect.
   */
  version?: number;
  cells: Record<string, RegisterCell>;
}

export interface RegisterFilterView {
  key: string;
  label: string;
  value: string | null;
  valueLabel: string | null;
  options: { value: string; label: string; href: string }[];
  clearHref: string;
  disabledReason?: string;
}
