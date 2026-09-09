import type { ReactNode } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * The shape a settings section is made of: a card of rows, each a label, a
 * sentence saying what the setting does, and one control.
 *
 * One component rather than each section laying out its own, because the thing
 * being kept constant is the *reading* rhythm — where the label sits, how far
 * the control is from it, how much air separates two settings. A section that
 * arranged its own rows would be a section that reads slightly differently from
 * the one above it in the rail, and the difference would look like a defect
 * without ever being one anybody could point at.
 */

export function SettingsCard({
  title,
  description,
  children,
  actions,
  className,
}: {
  title: string;
  description?: string | undefined;
  children: ReactNode;
  /** Buttons for the card as a whole — a save, usually. */
  actions?: ReactNode;
  className?: string | undefined;
}) {
  return (
    /*
     * A measure of 48rem, applied here rather than by the layout.
     *
     * A column of label-and-one-control rows becomes unreadable long before a
     * table does: at 1200px the label is at one end of the monitor and the
     * switch at the other, and the eye has to travel the whole width to connect
     * them. The sections that are registers — the audit log, the vocabularies —
     * do not use this card and are not capped.
     */
    <Card
      className={cn(
        "w-full min-w-0 overflow-hidden rounded-xl border border-border/80 bg-card shadow-2xs",
        className,
      )}
    >
      <CardHeader className="border-b border-border/40 bg-muted/20 px-4 py-2.5 sm:px-5 sm:py-3">
        <CardTitle className="text-sm sm:text-base font-semibold text-foreground">
          {title}
        </CardTitle>
        {description && (
          <CardDescription className="text-xs text-muted-foreground mt-0.5">
            {description}
          </CardDescription>
        )}
      </CardHeader>
      <CardContent className="flex flex-col divide-y divide-border/40 p-3.5 sm:p-4">
        {children}
      </CardContent>
      {actions && (
        <div className="flex flex-wrap justify-end gap-2.5 border-t border-border/40 bg-muted/10 px-4 py-2.5 sm:px-5 sm:py-3">
          {actions}
        </div>
      )}
    </Card>
  );
}

export function SettingRow({
  label,
  hint,
  control,
  htmlFor,
  /** Puts the control under the label rather than beside it. */
  stacked,
  /** Lets a text field fill the available half of a wide settings row. */
  fluidControl,
}: {
  label: string;
  hint?: string | undefined;
  control: ReactNode;
  htmlFor?: string | undefined;
  stacked?: boolean | undefined;
  fluidControl?: boolean | undefined;
}) {
  return (
    <div
      data-setting-row
      data-setting-stacked={stacked || undefined}
      className={cn(
        "gap-3 py-2.5 first:pt-0 last:pb-0",
        stacked
          ? "flex flex-col"
          : "flex flex-col sm:grid sm:grid-cols-[minmax(0,1fr)_minmax(0,3fr)] sm:items-center",
      )}
    >
      <div className="flex min-w-0 flex-col gap-0.5">
        {/*
         * A `label` when there is a control to point at, a `span` when there is
         * not. A `label` with no `for` is a label for nothing — it reads as one
         * to a screen reader and then does nothing when clicked, which is worse
         * than plain text.
         */}
        {htmlFor ? (
          <label htmlFor={htmlFor} className="text-xs font-semibold text-foreground/90">
            {label}
          </label>
        ) : (
          <span className="text-xs font-semibold text-foreground/90">{label}</span>
        )}
        {hint && <span className="text-[11px] leading-relaxed text-muted-foreground">{hint}</span>}
      </div>
      <div
        data-setting-control
        className={cn(
          "flex min-w-0 items-center gap-2",
          stacked
            ? "w-full"
            : fluidControl
              ? "w-full min-w-0 max-w-[42rem] justify-self-stretch"
              : "shrink-0 justify-self-start",
        )}
      >
        {control}
      </div>
    </div>
  );
}
