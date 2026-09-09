import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import {
  StudentCompositionChart,
  StudentTrendChart,
} from "@/components/reports/student-analytics-charts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
}: {
  label: string;
  value: string;
  hint?: string | undefined;
  icon?: LucideIcon;
}) {
  return (
    <Card className="glow-card group relative overflow-hidden border border-border/90 bg-card p-0 shadow-2xs transition-all duration-200 hover:border-primary/40">
      <div
        aria-hidden
        className="pointer-events-none absolute -top-12 -end-12 size-28 rounded-full bg-primary/5 blur-2xl transition-all duration-300 group-hover:bg-primary/15"
      />
      <CardContent className="flex items-start justify-between gap-4 p-5">
        <div className="flex min-w-0 flex-col gap-1.5">
          <p className="text-xs font-medium text-muted-foreground">{label}</p>
          <p className="text-3xl/none font-bold tracking-tight text-foreground tabular-nums">
            {value}
          </p>
          {hint && <p className="mt-0.5 text-xs text-muted-foreground/90">{hint}</p>}
        </div>
        {Icon && (
          <div
            aria-hidden
            className="shrink-0 rounded-xl bg-primary/10 p-3 text-primary shadow-2xs ring-1 ring-inset ring-primary/20 transition-colors duration-200 group-hover:bg-primary/15"
          >
            <Icon className="size-5" />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function PanelCard({
  title,
  description,
  action,
  children,
  className,
}: {
  title: string;
  description?: string | undefined;
  action?: ReactNode;
  children: ReactNode;
  className?: string | undefined;
}) {
  return (
    <Card className={cn("overflow-hidden border border-border/90 bg-card shadow-2xs", className)}>
      <CardHeader className="flex flex-row items-center justify-between gap-4 border-b border-border/50 bg-muted/20 px-5 py-3.5">
        <div className="flex min-w-0 flex-col gap-0.5">
          <CardTitle className="text-sm font-semibold text-foreground sm:text-base">
            {title}
          </CardTitle>
          {description && <CardDescription className="text-xs">{description}</CardDescription>}
        </div>
        {action}
      </CardHeader>
      <CardContent className="p-5">{children}</CardContent>
    </Card>
  );
}

/** Shared report adapter for time-series panels. */
export function AdmissionsChart({
  years,
  labelFor,
  caption,
  emptyLabel,
}: {
  years: { year: number; count: number }[];
  labelFor: (value: number) => string;
  caption: string;
  emptyLabel: string;
}) {
  return (
    <div className="flex flex-col gap-3">
      <StudentTrendChart
        points={years}
        yearLabels={Object.fromEntries(
          years.map((point) => [String(point.year), labelFor(point.year)]),
        )}
        empty={emptyLabel}
        countLabel={caption}
      />
      <p className="text-xs text-muted-foreground">{caption}</p>
    </div>
  );
}

/** Shared report adapter for categorical composition panels. */
export function DegreeMix({
  slices,
  labelFor,
  emptyLabel,
}: {
  slices: { value: string; count: number }[];
  labelFor: (value: string) => string;
  formatNumber: (value: number) => string;
  emptyLabel: string;
}) {
  return (
    <StudentCompositionChart
      rows={slices}
      labels={Object.fromEntries(slices.map((slice) => [slice.value, labelFor(slice.value)]))}
      empty={emptyLabel}
    />
  );
}
