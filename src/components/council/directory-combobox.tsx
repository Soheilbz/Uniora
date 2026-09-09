"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { Combobox } from "@/components/ui/combobox";
import { searchCouncilDirectory } from "@/modules/council/directory-actions";
import type { DirectoryEntry } from "@/modules/council/roster";

type ValueMode = "id" | "name";

export function CouncilDirectoryCombobox({
  id,
  name,
  value,
  onChange,
  onEntrySelect,
  initialEntries,
  valueMode = "id",
  excludeIds = [],
  excludeNames = [],
  allowCustom = false,
  placeholder,
  ariaLabel,
}: {
  id?: string;
  name: string;
  value: string;
  onChange: (value: string) => void;
  onEntrySelect?: (entry: DirectoryEntry | null) => void;
  initialEntries: DirectoryEntry[];
  valueMode?: ValueMode;
  excludeIds?: readonly string[];
  excludeNames?: readonly string[];
  allowCustom?: boolean;
  placeholder?: string;
  ariaLabel?: string;
}) {
  const [entries, setEntries] = useState(initialEntries);
  const [, startTransition] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sequence = useRef(0);

  useEffect(() => {
    setEntries((current) => {
      const merged = new Map(current.map((entry) => [entry.id, entry]));
      for (const entry of initialEntries) merged.set(entry.id, entry);
      return [...merged.values()];
    });
  }, [initialEntries]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      sequence.current += 1;
    },
    [],
  );

  const excludedIdSet = useMemo(() => new Set(excludeIds), [excludeIds]);
  const excludedNameSet = useMemo(() => new Set(excludeNames), [excludeNames]);
  const available = useMemo(
    () =>
      entries.filter((entry) => !excludedIdSet.has(entry.id) && !excludedNameSet.has(entry.name)),
    [entries, excludedIdSet, excludedNameSet],
  );

  function search(text: string) {
    if (timer.current) clearTimeout(timer.current);
    const query = text.trim();
    const ticket = ++sequence.current;
    if (query.length < 2) {
      setEntries(initialEntries);
      return;
    }
    timer.current = setTimeout(() => {
      timer.current = null;
      startTransition(async () => {
        try {
          const found = await searchCouncilDirectory(query);
          if (sequence.current !== ticket) return;
          setEntries((current) => {
            const selected = current.filter((entry) =>
              valueMode === "id" ? entry.id === value : entry.name === value,
            );
            const merged = new Map([...selected, ...found].map((entry) => [entry.id, entry]));
            return [...merged.values()];
          });
        } catch {
          /* Keep the last good options. The form itself remains usable. */
        }
      });
    }, 250);
  }

  return (
    <Combobox
      id={id}
      name={name}
      value={value}
      onInputChange={search}
      onChange={(next) => {
        onChange(next);
        const picked = available.find((entry) =>
          valueMode === "id" ? entry.id === next : entry.name === next,
        );
        onEntrySelect?.(picked ?? null);
      }}
      placeholder={placeholder}
      aria-label={ariaLabel}
      options={available.map((entry) => ({
        value: valueMode === "id" ? entry.id : entry.name,
        label: entry.name,
      }))}
      allowCustom={allowCustom}
    />
  );
}
