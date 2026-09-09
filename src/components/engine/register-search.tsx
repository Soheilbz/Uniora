"use client";

import { Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { queryHref } from "@/lib/register/params.ts";
import type { RegisterQuery, RegisterSpec } from "@/lib/register/spec.ts";

/**
 * The register's search box.
 *
 * Its own component because it is the one control on this screen with state that
 * is not the URL: what somebody has typed but not yet committed. Everything else
 * — filters, sort, page — is a navigation.
 */
export function RegisterSearch({
  spec,
  query,
  placeholder,
  label,
}: {
  spec: RegisterSpec;
  query: RegisterQuery;
  placeholder: string;
  label: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [hydrated, setHydrated] = useState(false);
  const [draft, setDraft] = useState(query.search);
  const committed = useRef(query.search);
  /* A filter-panel navigation can update the query while somebody is already
   * typing. Keep the latest query available without making that navigation
   * tear down the debounce timer and silently discard the user's search. */
  const queryRef = useRef(query);
  queryRef.current = query;
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setHydrated(true);
  }, []);

  /*
   * The field follows the URL when the URL changes from elsewhere — the back
   * button, or "clear filters". Without this, going back leaves the previous
   * search sitting in a box whose results are no longer on screen.
   *
   * Guarded on the committed value rather than the draft, so it does not fight
   * with somebody mid-word when a navigation completes.
   */
  useEffect(() => {
    if (committed.current !== query.search) {
      committed.current = query.search;
      setDraft(query.search);
    }
  }, [query.search]);

  /* The debounce belongs to the draft, not to one particular input event. A
   * filter-panel navigation can replace this client component immediately
   * after it is opened; scheduling from the draft keeps the first search
   * value alive across that server-component boundary. */
  useEffect(() => {
    if (draft === committed.current) return;
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    if (retryTimer.current) clearTimeout(retryTimer.current);

    const navigate = (value: string, remainingAttempts: number) => {
      if (queryRef.current.search === value) {
        committed.current = value;
        return;
      }
      startTransition(() =>
        router.replace(queryHref(spec, queryRef.current, { search: value }, { filtersOpen: true })),
      );
      if (remainingAttempts > 0) {
        retryTimer.current = setTimeout(() => {
          retryTimer.current = null;
          navigate(value, remainingAttempts - 1);
        }, 500);
      }
    };

    debounceTimer.current = setTimeout(() => {
      debounceTimer.current = null;
      navigate(draft, 4);
    }, 300);
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
      if (retryTimer.current) clearTimeout(retryTimer.current);
      debounceTimer.current = null;
      retryTimer.current = null;
    };
  }, [draft, router, spec]);

  return (
    <div className="relative w-full sm:max-w-sm">
      <Search
        className="pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden
      />
      <Input
        type="search"
        value={draft}
        onChange={(event) => {
          const nextDraft = event.target.value;
          setDraft(nextDraft);
        }}
        /*
         * Enter commits immediately rather than waiting out the debounce.
         * Somebody who has typed a whole student number and pressed Enter has
         * said they are finished; another 300ms reads as the application being
         * slow.
         */
        onKeyDown={(event) => {
          if (event.key !== "Enter") return;
          event.preventDefault();
          if (debounceTimer.current) {
            clearTimeout(debounceTimer.current);
            debounceTimer.current = null;
          }
          if (retryTimer.current) {
            clearTimeout(retryTimer.current);
            retryTimer.current = null;
          }
          committed.current = draft;
          startTransition(() =>
            router.push(
              queryHref(spec, queryRef.current, { search: draft }, { filtersOpen: true }),
            ),
          );
        }}
        placeholder={placeholder}
        aria-label={label}
        data-register-search-hydrated={hydrated ? "true" : "false"}
        className="h-9 rounded-lg border-input bg-card/90 ps-8 pe-8 text-xs placeholder:text-muted-foreground/70 transition-colors"
      />
      {/*
       * `aria-hidden`: the result count below is the announcement that matters.
       * A spinner that says "loading" on every third keystroke is noise in a
       * screen reader.
       */}
      {pending && (
        <Spinner
          className="absolute end-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
      )}
    </div>
  );
}
