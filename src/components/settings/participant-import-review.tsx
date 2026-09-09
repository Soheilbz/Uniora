import { TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { SettingsCard } from "@/components/settings/setting-row";

export function ImportReviewCard({
  title,
  hint,
  facts,
  format,
  children,
}: {
  title: string;
  hint: string;
  facts: Array<[string, number]>;
  format: Intl.NumberFormat;
  children?: ReactNode;
}) {
  return (
    <SettingsCard title={title} description={hint}>
      <div className="flex flex-col gap-4 py-2">
        <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {facts.map(([label, value]) => (
            <ImportFact key={label} label={label} value={value} format={format} />
          ))}
        </dl>
        {children}
      </div>
    </SettingsCard>
  );
}

export function ImportFact({
  label,
  value,
  format,
}: {
  label: string;
  value: number;
  format: Intl.NumberFormat;
}) {
  return (
    <div className="rounded-lg border bg-muted/20 p-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="numeric mt-1 text-lg font-semibold">{format.format(value)}</dd>
    </div>
  );
}

export function ImportFaults({
  faults,
  t,
  format,
}: {
  faults: Array<{ row: number; reason: string; detail: string }>;
  t: Record<string, string>;
  format: Intl.NumberFormat;
}) {
  return (
    <div className="rounded-lg border p-3">
      <p className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
        <TriangleAlert className="size-4" aria-hidden />
        {t.faultsHint}
      </p>
      <ul className="max-h-56 space-y-1 overflow-auto text-xs">
        {faults.slice(0, 100).map((fault) => (
          <li key={`${fault.row}-${fault.reason}-${fault.detail}`} className="flex flex-wrap gap-2">
            <span className="font-medium">
              {t.faultRowColumn} {format.format(fault.row)}
            </span>
            <span className="text-muted-foreground">
              {t[`fault.${fault.reason}`] ?? fault.reason}
            </span>
            {fault.detail && (
              <span dir="ltr" className="text-muted-foreground">
                {fault.detail}
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
