"use client";

import { Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { MAX_SEARCH_LENGTH } from "@/lib/input-limits.ts";

/**
 * Finding the case a form is printed from.
 *
 * The one control on this screen holding state that is not the URL: what
 * somebody has typed but not yet committed. Choosing a case and choosing a form
 * are both navigations, so they are links.
 *
 * Changing the search drops the chosen case, deliberately — the previous case
 * is almost never in the new results, and a form still showing somebody else's
 * name while the list beside it shows a different student is the one state on
 * this screen that could get a wrong sheet signed.
 */
export function SheetSearch({
  value,
  placeholder,
  label,
}: {
  value: string;
  placeholder: string;
  label: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [draft, setDraft] = useState(value);
  const committed = useRef(value);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* Follow the URL when it changes from elsewhere — the back button leaves a
     stale search sitting in the box otherwise. */
  useEffect(() => {
    if (committed.current !== value) {
      committed.current = value;
      setDraft(value);
    }
  }, [value]);

  /* 300ms, for the reason the registers use it: every keystroke is a query with
     a folded scan behind it, and at a couple of thousand people at once,
     search-as-you-type without a delay turns one impatient clerk into a hundred
     queries a second. */
  useEffect(() => {
    if (draft === committed.current) return;
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      debounceTimer.current = null;
      committed.current = draft;
      const next =
        draft.trim() === "" ? "/worksheets" : `/worksheets?q=${encodeURIComponent(draft)}`;
      startTransition(() => router.replace(next));
    }, 300);
    return () => {
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current);
        debounceTimer.current = null;
      }
    };
  }, [draft, router]);

  return (
    <div className="relative w-full">
      <Search
        className="pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden
      />
      <Input
        type="search"
        maxLength={MAX_SEARCH_LENGTH}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== "Enter") return;
          event.preventDefault();
          if (debounceTimer.current) {
            clearTimeout(debounceTimer.current);
            debounceTimer.current = null;
          }
          committed.current = draft;
          const next =
            draft.trim() === "" ? "/worksheets" : `/worksheets?q=${encodeURIComponent(draft)}`;
          startTransition(() => router.push(next));
        }}
        placeholder={placeholder}
        aria-label={label}
        className="ps-8 pe-8"
      />
      {pending && (
        <Spinner className="absolute end-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      )}
    </div>
  );
}
