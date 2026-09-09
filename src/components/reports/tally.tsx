import { cn } from "@/lib/utils";

/**
 * A labelled count, as a bar whose length is its share of the largest.
 *
 * ── Why a bar and not just a number ─────────────────────────────────────────
 *
 * The question these panels answer is comparative — «کدام رشته بیشترین دانشجو
 * را دارد» — and a column of figures makes the reader do the comparing. A bar
 * scaled to the *largest* row rather than to the total is what keeps the small
 * ones legible: scaled to the total, a list of twenty fields would be twenty
 * slivers, and the third-largest would be indistinguishable from the tenth.
 *
 * ── Why the count is not a percentage ───────────────────────────────────────
 *
 * These are registers of people. «۱۴ نفر» is something an office can act on and
 * «۱۲٪» is not, and the bar already carries the proportion.
 */
export function Tally({
  rows,
  label,
  figure,
  empty,
  limit = 12,
}: {
  rows: { value: string; count: number }[];
  label: (value: string) => string;
  figure: (count: number) => string;
  empty: string;
  /** How many rows before the tail is summarised. */
  limit?: number;
}) {
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">{empty}</p>;

  const peak = Math.max(...rows.map((row) => row.count), 1);
  const shown = rows.slice(0, limit);
  const tail = rows.slice(limit);
  const tailCount = tail.reduce((sum, row) => sum + row.count, 0);

  return (
    <ul className="flex flex-col gap-2">
      {shown.map((row) => (
        <li key={row.value} className="flex flex-col gap-1">
          <div className="flex items-baseline justify-between gap-3">
            <span className="min-w-0 truncate text-sm">{label(row.value)}</span>
            <span className="numeric shrink-0 text-sm tabular-nums">{figure(row.count)}</span>
          </div>
          {/*
           * `aria-hidden`: the figure beside the label already says what the
           * bar says. Announcing both would read every row twice.
           */}
          <div aria-hidden className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className={cn("h-full rounded-full bg-primary/70")}
              style={{ width: `${Math.max((row.count / peak) * 100, row.count > 0 ? 2 : 0)}%` }}
            />
          </div>
        </li>
      ))}

      {/* The tail as one row rather than a scroll. A panel that listed forty
          fields would be a panel nobody reads to the end of. */}
      {tail.length > 0 && (
        <li className="flex items-baseline justify-between gap-3 border-t pt-2 text-sm text-muted-foreground">
          <span>+{figure(tail.length)}</span>
          <span className="numeric tabular-nums">{figure(tailCount)}</span>
        </li>
      )}
    </ul>
  );
}
