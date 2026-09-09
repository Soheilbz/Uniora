"use client";

import type { ComponentProps, HTMLAttributes, KeyboardEvent, ReactElement, ReactNode } from "react";
import { Children, useEffect, useRef } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

/**
 * The command strip above a list.
 *
 * `role="toolbar"` promises one tab stop with arrow keys inside it rather than
 * eight — a strip with seven commands otherwise costs seven presses to tab past,
 * on every screen, for anybody working by keyboard. The browser does not deliver
 * that promise on its own, so the roving tabindex lives here: exactly one item
 * is tabbable at a time, focus moves with the arrow keys, and the tab stop
 * follows focus so tabbing out and back returns to the command the reader left.
 *
 * The arrows follow the reading direction. "Next" is ArrowRight in an English
 * interface and ArrowLeft in a Persian one, because the next command is the one
 * the eye reaches next — read from the computed direction rather than a prop, so
 * no screen has to say which way it runs.
 *
 * `flex-wrap`: Persian command labels run half again as long as their English
 * equivalents, so a nowrap strip does not mean "one line", it means "the last
 * two commands are off the edge".
 */

function focusableItems(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>("button, [href]")].filter(
    (item) => !item.hasAttribute("disabled") && item.getAttribute("aria-disabled") !== "true",
  );
}

export function Toolbar({
  label,
  className,
  children,
  ...props
}: HTMLAttributes<HTMLDivElement> & { label: string }) {
  const ref = useRef<HTMLDivElement>(null);

  /*
   * One tab stop, kept true across renders. Deliberately without a dependency
   * array: the items are read from the DOM, and any change to them — a command
   * appearing, one becoming disabled — arrives via a render. Whichever item
   * currently holds the tab stop keeps it; if none does (first mount, or the
   * holder was removed) the first item takes it.
   */
  useEffect(() => {
    const container = ref.current;
    if (!container) return;
    const items = focusableItems(container);
    const current = items.find((item) => item.tabIndex === 0) ?? items[0];
    for (const item of items) item.tabIndex = item === current ? 0 : -1;
  });

  return (
    <div
      ref={ref}
      role="toolbar"
      aria-label={label}
      aria-orientation="horizontal"
      data-print-hide
      className={cn(
        "flex flex-wrap items-center gap-1.5 rounded-xl border border-border/80 bg-card/95 px-3 py-1.5 shadow-2xs backdrop-blur-xs",
        className,
      )}
      {...props}
      onFocus={(event) => {
        const container = ref.current;
        if (!container) return;
        const items = focusableItems(container);
        const target = event.target as HTMLElement;
        if (!items.includes(target)) return;
        // The tab stop follows focus, so tabbing away and back returns here.
        for (const item of items) item.tabIndex = item === target ? 0 : -1;
      }}
      onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
        const { key } = event;
        if (key !== "ArrowRight" && key !== "ArrowLeft" && key !== "Home" && key !== "End") return;
        const container = ref.current;
        if (!container) return;
        const items = focusableItems(container);
        const index = items.indexOf(event.target as HTMLElement);
        if (index === -1) return;

        // "Next" is the arrow that points the way the text runs.
        const forward =
          getComputedStyle(container).direction === "rtl" ? "ArrowLeft" : "ArrowRight";
        const next =
          key === "Home"
            ? 0
            : key === "End"
              ? items.length - 1
              : key === forward
                ? Math.min(index + 1, items.length - 1)
                : Math.max(index - 1, 0);

        event.preventDefault();
        items[next]?.focus();
      }}
    >
      {/* Slots often arrive as fragments or arrays from server pages. Normalise
          them here so every command has a stable React key at this shared
          reconciliation boundary. */}
      {Children.toArray(children)}
    </div>
  );
}

export function ToolbarButton({
  icon,
  checked,
  primary,
  href,
  render,
  className,
  children,
  ...props
}: Omit<ComponentProps<typeof Button>, "variant" | "size"> & {
  icon?: ReactNode;
  /**
   * Marks a toggle that is on — «فیلترها» while filters are showing. Passing it
   * also sets `aria-pressed`; leave it undefined for a plain command.
   */
  checked?: boolean;
  /** The filled command: the one somebody came here to press. */
  primary?: boolean;
  /** A URL-backed command remains usable before client hydration. */
  href?: string;
  render?: ReactElement;
}) {
  const variant = primary ? "default" : "ghost";
  const toolbarClassName = cn(
    "rounded-lg font-medium text-xs transition-all duration-150",
    checked &&
      "bg-primary/10 text-primary font-semibold hover:bg-primary/15 hover:text-primary dark:bg-primary/20 dark:text-primary-foreground",
    className,
  );
  const pressed = checked === undefined ? {} : { "aria-pressed": checked };
  const shared = {
    variant: variant as "default" | "ghost",
    size: "sm" as const,
    ...pressed,
    className: toolbarClassName,
  };

  if (href) {
    return (
      <a
        href={href}
        onClick={(event) => {
          event.preventDefault();
          window.location.assign(href);
        }}
        className={buttonVariants({ variant, size: "sm", className: toolbarClassName })}
      >
        {icon}
        {children}
      </a>
    );
  }

  return render ? (
    <Button {...shared} {...props} nativeButton={false} render={render} />
  ) : (
    <Button {...shared} {...props}>
      {icon}
      {children}
    </Button>
  );
}

export function ToolbarDivider() {
  return <Separator orientation="vertical" className="mx-1 h-6 self-center" />;
}

/**
 * One kind of command, fenced off from the next by a divider.
 *
 * The label is required and it is not decoration: a divider is a line, and a
 * line is nothing to a screen reader beyond "there is a boundary here".
 * `role="group"` with a name is what turns that boundary into a named thing, and
 * it is the only part of the grouping that survives having the CSS switched off.
 */
export function ToolbarGroup({
  label,
  className,
  children,
  ...props
}: Omit<HTMLAttributes<HTMLDivElement>, "role"> & { label: string }) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: a <fieldset> is a set of form controls and needs a <legend>; this is a run of commands inside a toolbar
    <div
      role="group"
      aria-label={label}
      className={cn("flex flex-wrap items-center gap-0.5", className)}
      {...props}
    >
      {Children.toArray(children)}
    </div>
  );
}
