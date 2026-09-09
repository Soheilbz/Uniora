"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Combobox } from "@/components/ui/combobox";
import { Spinner } from "@/components/ui/spinner";

export interface SittingChoice {
  /** The sitting's number as the archive spells it — «۶۸۰». */
  value: string;
  label: string;
}

/**
 * Which sitting the document on the right belongs to.
 */
export function SittingPicker({
  sittings,
  selected,
  base,
  label,
  placeholder,
}: {
  sittings: SittingChoice[];
  selected: string;
  /** The document's own path — `/council-minutes` or `/council-checklist`. */
  base: string;
  label: string;
  placeholder: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex items-center gap-2 w-full">
      <Combobox
        name="sittingSelect"
        value={selected || ""}
        onChange={(next: string) => {
          if (!next) {
            startTransition(() => router.push(base));
            return;
          }
          startTransition(() => router.push(`${base}?meeting=${encodeURIComponent(next)}`));
        }}
        placeholder={placeholder}
        aria-label={label}
        options={sittings}
        allowCustom={false}
      />
      {pending && <Spinner className="size-4 shrink-0" />}
    </div>
  );
}
