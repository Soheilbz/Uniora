import { CheckCircle2, CircleAlert } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Completeness summary used by the student report.
 *
 * Number and percentage rendering are supplied by the server page so this
 * component never bakes Persian digits or a Persian percent sign into an
 * otherwise translated report.
 */
export function CompletenessCard({
  complete,
  incomplete,
  total,
  figure,
  percent,
  title,
  hint,
  completeLabel,
  incompleteLabel,
}: {
  complete: number;
  incomplete: number;
  total: number;
  figure: (value: number) => string;
  percent: (ratio: number) => string;
  title: string;
  hint: string;
  completeLabel: string;
  incompleteLabel: string;
}) {
  const ratio = total === 0 ? 0 : complete / total;
  const percentage = ratio * 100;
  return (
    <Card className="overflow-hidden border border-border/90 bg-card shadow-2xs">
      <CardHeader className="border-b border-border/50 bg-muted/20 px-5 py-3.5">
        <CardTitle className="text-sm font-semibold sm:text-base">{title}</CardTitle>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </CardHeader>
      <CardContent className="flex flex-col gap-5 p-5">
        <div className="flex items-center gap-5">
          <div
            className="relative grid size-28 shrink-0 place-items-center rounded-full"
            style={{
              background: `conic-gradient(hsl(var(--primary)) ${percentage}%, hsl(var(--muted)) 0)`,
            }}
          >
            <div className="grid size-20 place-items-center rounded-full bg-card">
              <span className="numeric text-2xl font-bold tabular-nums">{percent(ratio)}</span>
            </div>
          </div>
          <div className="flex min-w-0 flex-col gap-2 text-sm">
            <div className="flex items-center justify-between gap-4">
              <span className="flex items-center gap-1.5">
                <CheckCircle2 className="size-4 text-emerald-600" aria-hidden />
                {completeLabel}
              </span>
              <span className="numeric font-semibold">{figure(complete)}</span>
            </div>
            <div className="flex items-center justify-between gap-4">
              <span className="flex items-center gap-1.5">
                <CircleAlert className="size-4 text-amber-600" aria-hidden />
                {incompleteLabel}
              </span>
              <span className="numeric font-semibold">{figure(incomplete)}</span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
