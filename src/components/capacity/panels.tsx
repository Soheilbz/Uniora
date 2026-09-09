import { TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { CapacityInput } from "@/modules/capacity/regulation.ts";

/**
 * The pieces the three capacity screens share.
 *
 * All three answer one question — «may this person take another student» — and
 * all three have to answer it the same way, including when the answer is «we
 * cannot say». A banner worded differently on the register and on the working
 * behind it would read as two different conditions.
 */

/**
 * The notice that everything below rests on inputs nobody has supplied.
 *
 * Drawn once, prominently, and never as a small grey line: a figure whose
 * caveat can be skimmed past is a figure that will be quoted without it. It
 * names what is missing and how to supply it, because a warning nobody can act
 * on becomes furniture.
 */
export function ProvisionalNotice({
  title,
  hint,
  inputsLabel,
  supplyLabel,
  inputs,
}: {
  title: string;
  hint: string;
  inputsLabel: string;
  supplyLabel: string;
  inputs: readonly CapacityInput[];
}) {
  if (inputs.length === 0) return null;
  return (
    <section className="flex flex-col gap-3 rounded-md border border-warning/40 bg-warning/5 p-4">
      <div className="flex items-start gap-2">
        <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning-foreground" aria-hidden />
        <div className="flex flex-col gap-1">
          <h2 className="text-sm font-semibold text-warning-foreground">{title}</h2>
          <p className="text-xs leading-relaxed text-muted-foreground">{hint}</p>
        </div>
      </div>

      <details className="text-xs">
        {/*
         * Folded, because it is fifteen rows and the *fact* that figures are
         * provisional is what has to be read every time; the list is what the
         * one person doing something about it opens.
         */}
        <summary className="cursor-pointer font-medium">
          {inputsLabel}
          <span className="numeric ms-1 text-muted-foreground">({inputs.length})</span>
        </summary>
        <ul className="mt-2 flex flex-col divide-y border-s ps-3">
          {inputs.map((input) => (
            <li key={input.id} className="flex flex-col gap-0.5 py-2 first:pt-0 last:pb-0">
              <span className="flex flex-wrap items-baseline gap-2">
                <span className="font-medium">{input.label}</span>
                <Badge variant="outline" className="font-normal text-muted-foreground">
                  {input.citation}
                </Badge>
              </span>
              <span className="text-muted-foreground">
                {supplyLabel}: {input.supply}
              </span>
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}

/**
 * One figure, with the wording that says what it is.
 *
 * `null` prints «—» and not «۰». The two are different answers and the
 * difference decides an appointment: zero remaining means «full», and no figure
 * at all means the regulation's tables have no column for this rank.
 */
export function Figure({
  value,
  label,
  tone,
  format,
}: {
  value: number | null;
  label: string;
  tone?: "over" | "muted";
  format: (value: number) => string;
}) {
  return (
    <span className="flex flex-col">
      <span className="text-[0.7rem] text-muted-foreground">{label}</span>
      <span
        className={cn(
          "numeric text-sm tabular-nums",
          tone === "over" && "font-semibold text-destructive",
          tone === "muted" && "text-muted-foreground",
        )}
      >
        {value === null ? "—" : format(value)}
      </span>
    </span>
  );
}

/** A labelled band on a capacity screen. */
export function Band({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-semibold">{title}</h2>
      {children}
    </section>
  );
}
