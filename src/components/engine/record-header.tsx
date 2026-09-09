import type { ReactNode } from "react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";

/**
 * A record's opening block: who this is, and what may be done about them.
 *
 * It replaces `PageHeader`'s `h1` on a record page rather than sitting under
 * one — a visible title above this block printed the same name twice, stacked.
 * The heading here is the page's `h1`, at the same scale every other screen's
 * title takes, because the largest text on a page should not shrink for having
 * a face beside it.
 */
export function RecordHeader({
  name,
  standing,
  secondary,
  identifier,
  actions,
}: {
  name: string;
  standing?: ReactNode;
  secondary?: string | null;
  /** The student number — laid out left-to-right, in tabular figures. */
  identifier?: string | null;
  actions?: ReactNode;
}) {
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0] ?? "")
    .join("");

  return (
    /*
     * `items-center`: the avatar is 72px against a two-line text block of about
     * 44, and top-aligning the pair leaves the name floating past the circle's
     * shoulder. Centring the cross axis is what makes the row read as one unit.
     */
    <header className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-border/70 bg-card/60 p-4 sm:p-5 shadow-2xs backdrop-blur-xs">
      <div className="flex items-center gap-4 min-w-0 flex-1">
        {/* Decorative: the `h1` beside it already carries the name, so labelling
            the circle would have a screen reader read the name twice. */}
        <Avatar
          aria-hidden
          className="size-14 sm:size-16 shrink-0 rounded-xl ring-1 ring-primary/30 bg-primary/10 shadow-2xs"
        >
          <AvatarFallback className="text-base sm:text-lg font-bold text-primary">
            {initials}
          </AvatarFallback>
        </Avatar>

        <div className="min-w-0 flex-1">
          <h1 className="mb-1 text-xl sm:text-2xl font-bold text-foreground">{name}</h1>
          <div className="flex flex-wrap items-center gap-2">
            {standing}
            {secondary && (
              <span className="text-xs sm:text-sm text-muted-foreground font-medium">
                {secondary}
              </span>
            )}
            {identifier && (
              <>
                {/*
                 * A hairline between the placement and the number. It is
                 * decoration — the two facts are already separate elements — so it
                 * is hidden rather than announced as a separator between two
                 * things a screen reader reads apart anyway.
                 */}
                <span aria-hidden className="h-3 w-px bg-border/80" />
                <span
                  dir="ltr"
                  className="numeric inline-flex items-center rounded-md bg-muted/60 px-2 py-0.5 text-xs font-semibold text-foreground/90 border border-border/50"
                >
                  {identifier}
                </span>
              </>
            )}
          </div>
        </div>
      </div>

      {actions && (
        /*
         * Below `sm` the actions take a row of their own, deliberately. The name
         * block is `flex-1 min-w-0`, so it *shrinks* rather than pushes: left
         * alone on a phone the buttons stay on the first row and squeeze the
         * name into a sliver behind them. `w-full` makes the stack explicit —
         * avatar and name first, buttons beneath.
         */
        <div
          data-print-hide
          className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:shrink-0"
        >
          {actions}
        </div>
      )}
    </header>
  );
}
