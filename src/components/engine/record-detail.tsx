import type { ReactNode } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * A record, read rather than edited.
 *
 * One card per section, and inside each a description list — `dl`/`dt`/`dd`,
 * not a grid of divs. That is the element the content actually is, and it is
 * what lets a screen reader announce "کد ملی: ۰۴۹۹۳۷۰۸۹۹" as a pair instead of
 * reading fifty labels and then fifty unattached values.
 */

export function RecordSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <Card className="overflow-hidden rounded-xl border border-border/80 bg-card/95 shadow-2xs backdrop-blur-xs">
      <CardHeader className="border-b border-border/40 bg-muted/20 px-5 py-3.5">
        <CardTitle className="text-sm sm:text-base font-semibold text-foreground">
          {title}
        </CardTitle>
        {description && (
          <CardDescription className="text-xs text-muted-foreground mt-0.5">
            {description}
          </CardDescription>
        )}
      </CardHeader>
      <CardContent className="p-4 sm:p-5">
        <dl className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">{children}</dl>
      </CardContent>
    </Card>
  );
}

export function RecordField({
  label,
  children,
  ltr,
  className,
  empty = "—",
}: {
  label: string;
  children: ReactNode;
  ltr?: boolean;
  className?: string;
  empty?: string;
}) {
  /*
   * `null`, `undefined` and `""` are all "not recorded" and all render the
   * dash. The field is still shown: a record page that hides its empty fields
   * is a page where an operator cannot tell whether the office never recorded a
   * father's name or whether this screen simply does not have that field.
   */
  const missing =
    children === null || children === undefined || children === "" || children === false;

  return (
    <div
      className={cn(
        "flex flex-col gap-1 rounded-lg border border-border/60 bg-background/60 p-2.5 sm:p-3 transition-colors hover:border-primary/30 hover:bg-background/90",
        className,
      )}
    >
      <dt className="text-[11px] font-semibold text-muted-foreground">{label}</dt>
      <dd
        {...(ltr && !missing ? { dir: "ltr" } : {})}
        className={cn(
          "min-h-5 text-xs sm:text-sm font-semibold text-foreground",
          missing && "font-normal text-muted-foreground/70",
          ltr && "numeric text-start",
        )}
      >
        {missing ? empty : children}
      </dd>
    </div>
  );
}
