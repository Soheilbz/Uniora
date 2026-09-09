/**
 * What a register remembers between renders: which columns are shown, and which
 * rows are ticked.
 *
 * ── Why these are functions and not inline in the component ─────────────────
 *
 * Both are decisions with edge cases and neither is reachable from a static
 * render: the column picker's contents mount only when the menu is opened, and
 * a selection exists only after somebody has clicked. `register-view.test.tsx`
 * covers everything the first render puts on the page; this covers the rest,
 * the same way `leaving.ts` covers the unsaved-work rule.
 *
 * Pure, and deliberately ignorant of React — a `Set` in, a `Set` out. That is
 * what makes «ticking a row already ticked unticks it» a sentence a test can
 * assert rather than a click somebody has to simulate.
 */

export interface ColumnVisibility {
  key: string;
  /** A column the picker may not hide — see `RegisterColumn.locked`. */
  locked?: boolean;
}

/**
 * The columns to draw, in the register's own order.
 *
 * `locked` wins over the hidden set rather than merely being un-tickable in the
 * picker. The two are not the same check: the hidden set outlives a change of
 * columns, so a register that *gains* a locked column after somebody hid one of
 * that name would otherwise draw a table with no identity in it and nothing on
 * screen to explain why.
 */
export function visibleColumns<T extends ColumnVisibility>(
  columns: readonly T[],
  hidden: ReadonlySet<string>,
): T[] {
  return columns.filter((column) => column.locked === true || !hidden.has(column.key));
}

/**
 * The hidden set after somebody ticks or unticks one entry in the picker.
 *
 * A locked column returns the set unchanged — identical by reference, so a
 * render is not scheduled for a change that did not happen.
 */
export function toggleColumn<T extends ColumnVisibility>(
  hidden: ReadonlySet<string>,
  column: T,
  shown: boolean,
): ReadonlySet<string> {
  if (column.locked === true) return hidden;
  const next = new Set(hidden);
  if (shown) next.delete(column.key);
  else next.add(column.key);
  return next;
}

/** The selection after one row's tick box is clicked. */
export function toggleRow(selected: ReadonlySet<string>, id: string): ReadonlySet<string> {
  const next = new Set(selected);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

/**
 * The selection after the header's tick box is clicked.
 *
 * The header ticks *this page*, not the register: what it can promise is what it
 * can see. Rows selected on another page stay selected — somebody who ticks four
 * on page one, pages forward and ticks two more means six, and silently dropping
 * the first four would delete the wrong records.
 *
 * Which direction it goes is decided by the page, not by a stored flag: if every
 * row here is already ticked the click clears them, otherwise it adds the ones
 * that are not.
 */
export function togglePage(
  selected: ReadonlySet<string>,
  pageIds: readonly string[],
): ReadonlySet<string> {
  const next = new Set(selected);
  if (allSelected(selected, pageIds)) {
    for (const id of pageIds) next.delete(id);
  } else {
    for (const id of pageIds) next.add(id);
  }
  return next;
}

/**
 * Whether every row on this page is ticked.
 *
 * False for an empty page: a header tick box reading "all selected" over no
 * rows is a claim about nothing, and clicking it would do nothing while looking
 * as though it had.
 */
export function allSelected(selected: ReadonlySet<string>, pageIds: readonly string[]): boolean {
  return pageIds.length > 0 && pageIds.every((id) => selected.has(id));
}

/**
 * The one selected row, when there is exactly one.
 *
 * «ویرایش» opens a record, and a record is one row. With none ticked there is
 * nothing to open; with three there is no answer to which — so the command is
 * disabled in both cases rather than guessing at the first.
 */
export function singleSelection(selected: ReadonlySet<string>): string | undefined {
  return selected.size === 1 ? [...selected][0] : undefined;
}
