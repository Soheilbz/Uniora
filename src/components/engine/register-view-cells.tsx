"use client";

import { Mars, UserRound, Venus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Combobox } from "@/components/ui/combobox";
import type { RegisterFilterView } from "./register-view-types.ts";

export function FilterSelect({
  filter,
  allLabel,
}: {
  filter: RegisterFilterView;
  allLabel: string;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  return (
    <div className="flex min-w-[8.5rem] flex-1 flex-col gap-1 sm:min-w-[10rem] max-w-[15rem]">
      <label
        htmlFor={`filter-${filter.key}`}
        className="truncate text-xs font-semibold text-foreground/80"
      >
        {filter.label}
      </label>
      <Combobox
        id={`filter-${filter.key}`}
        name={filter.key}
        value={filter.value ?? ""}
        disabled={Boolean(filter.disabledReason)}
        placeholder={allLabel}
        aria-label={filter.label}
        options={[{ value: "", label: allLabel }, ...filter.options]}
        onChange={(val) => {
          const href =
            !val || val === ""
              ? filter.clearHref
              : filter.options.find((option) => option.value === val)?.href;
          if (href) startTransition(() => router.push(href));
        }}
        allowCustom={false}
      />
    </div>
  );
}

/**
 * A panel of people, one per line.
 *
 * Three supervisors are three people. Folded onto one line the third is lost,
 * and a reader counting a panel cannot tell a two-person panel from a truncated
 * three-person one — which on this register is the difference between a case
 * that is ready for its sitting and one that is not.
 */
export function NamePanel({
  list,
  distinct,
}: {
  list: (string | null)[];
  distinct: { name: string | null; label: string } | null;
}) {
  const present = list.filter((name): name is string => Boolean(name?.trim()));
  const special = distinct?.name?.trim() ? distinct.name.trim() : null;

  if (present.length === 0 && !special) return <span className="text-muted-foreground">—</span>;

  return (
    <ul className="min-w-0 w-full space-y-1 text-xs">
      {present.map((name) => (
        <li
          key={name}
          className="break-words text-wrap leading-relaxed text-foreground font-medium"
        >
          {name}
        </li>
      ))}
      {special && (
        /*
         * Marked *and* said in words. Colour alone would leave the office
         * invisible to a reader who cannot distinguish it and to anybody
         * printing in greyscale — and this cell prints.
         */
        <li
          className="break-words text-wrap font-medium text-destructive leading-relaxed"
          title={distinct?.label}
        >
          {special}
          {distinct?.label && (
            <span className="ms-1 text-xs font-normal opacity-80">({distinct.label})</span>
          )}
        </li>
      )}
    </ul>
  );
}

/**
 * The gender marker that sits before a name.
 *
 * Labelled when it is known and `aria-hidden` when it is not — the neutral
 * figure is there to keep the column's names aligned, and announcing «person»
 * on every unrecorded row would be noise a screen reader has to listen past.
 */
export function GenderMark({ value, label }: { value: string | null; label: string | null }) {
  const Icon = value === "male" ? Mars : value === "female" ? Venus : UserRound;
  return value && label ? (
    <Icon className="size-4 shrink-0 text-muted-foreground" aria-label={label} />
  ) : (
    <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
  );
}
