import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * The page's title block: breadcrumbs above, the `h1` and its description on the
 * inline start, the page-level actions on the inline end.
 *
 * A Server Component with no state, which is the whole of what it needed to
 * become one. This component is intentionally server-renderable and supports a
 * reason — a `useEffect` that wrote `document.title` — and that reason does not
 * survive the move to a server framework: the browser tab is `metadata` in the
 * route, rendered into the document before it reaches the browser, so the tab is
 * right in the first paint and right in a bookmark, a share and a search result.
 *
 * It has no bottom margin, deliberately. Space between a page's bands belongs to
 * the one stack that can see all of them — `PageBody` — because a constant
 * margin here plus a `mb-4` on whatever follows produces a different rhythm on
 * every screen rather than the same one.
 */

export interface Crumb {
  label: string;
  href?: string;
}

export interface PageHeaderProps {
  /**
   * Optional: a record page draws its own name in a title block below, and a
   * visible `h1` above that printed the same name twice. Omitted means no `h1`
   * rather than an empty one, which would put a nameless top-level heading in
   * the outline.
   */
  title?: ReactNode;
  /** Keep the `h1` in the outline, out of the picture. See `title`. */
  titleHidden?: boolean;
  description?: ReactNode;
  breadcrumbs?: Crumb[];
  actions?: ReactNode;
  className?: string;
  /** Names the breadcrumb landmark. Supplied by the page, in the page's language. */
  breadcrumbLabel?: string;
}

export function PageHeader({
  title,
  titleHidden,
  description,
  breadcrumbs: _breadcrumbs,
  actions,
  className,
  breadcrumbLabel: _breadcrumbLabel,
}: PageHeaderProps) {
  const hasActionsOrDescription = Boolean(actions || description);

  // If there are no actions or description, we keep the h1 only for screen readers (sr-only)
  // because breadcrumbs and title are already prominently displayed in the top shell header.
  if (!hasActionsOrDescription) {
    return <header className="sr-only">{title && <h1>{title}</h1>}</header>;
  }

  return (
    <header className={cn("flex flex-col gap-2", className)}>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="flex min-w-0 flex-col gap-1">
          {title && !titleHidden && (
            <h1 className="text-xl font-bold tracking-tight text-foreground md:text-2xl">
              {title}
            </h1>
          )}
          {description && (
            <p className="text-xs text-muted-foreground leading-relaxed">{description}</p>
          )}
        </div>

        {actions && (
          <div data-print-hide className="flex flex-wrap items-center gap-2 pt-0.5">
            {actions}
          </div>
        )}
      </div>
    </header>
  );
}

/**
 * The vertical rhythm of a page, owned in one place.
 *
 * Every screen is a stack of bands — header, filters, table, pager — and the
 * space between them is this component's, not each band's. That is the fix for
 * a real defect in the application: bands carried their own `mb-6`,
 * `mb-4`, `mb-3` or nothing, so the gap above a notice was 24px and the gap
 * below it was 0.
 */
export function PageBody({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-2.5 flex-1 min-h-0 pb-8", className)}>{children}</div>
  );
}
