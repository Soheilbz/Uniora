/**
 * Which parts of the catalogue cross into the browser.
 *
 * ── Why this is a list and not the whole thing ──────────────────────────────
 *
 * Almost every screen in this product renders on the server, and a Server
 * Component's `getTranslations()` reads the catalogue on the machine that has
 * it. Only a `"use client"` component's `useTranslations()` needs the words
 * shipped, because only that one resolves them in the browser.
 *
 * The root layout passed the *entire* catalogue regardless — 35 namespaces,
 * 95 KB of Persian JSON — into the flight payload of every page. The single
 * biggest entries in it are `settings` and `sheet`, at 20 KB apiece, and
 * neither has a client component anywhere near it: the settings screens are
 * server-rendered forms and `sheet` is the worksheet wording, which is printed
 * from the server. An office of 3,000 people was downloading the whole
 * vocabulary of the application on every navigation to read a table of names.
 *
 * ── How the list is kept honest ─────────────────────────────────────────────
 *
 * By reading the source rather than by being remembered — see
 * `client-messages.test.ts`, which scans every `"use client"` file for the
 * namespaces it asks for and fails in *both* directions. A namespace added to
 * a client component and not to this list is caught before it can reach a
 * person, and one left here after its last client reader was deleted is caught
 * too, so the payload does not quietly grow back.
 *
 * Getting it wrong is loud rather than silent: next-intl throws on a namespace
 * it was not given, so a missing entry is a failed render in development, not
 * a screen of raw message paths in production.
 */

/**
 * The namespaces a `"use client"` component reads.
 *
 * Alphabetical, because the order means nothing and an ordered list is one
 * fewer thing to argue about in review.
 *
 * `council` and `errors` are here for two reasons each. Both are asked for by
 * name — the roster dialogs and the entity form — and both are also reachable
 * through the *rootless* `useTranslations()` in the roster, substitutions and
 * bulk-edit dialogs, which render whatever catalogue path a Server Action hands
 * back: `errors.record.conflict` from a stale write, `council.roster.duplicate`
 * from a seat that is already on the list. That second kind is why the test
 * below reads the actions as well as the components.
 */
export const CLIENT_NAMESPACES = [
  "actions",
  "attention",
  /* The (app) segment's error/not-found boundaries: client components that
     must speak for themselves when the server render has already failed. */
  "boundary",
  "bulkEdit",
  "common",
  "council",
  "decisions",
  "errors",
  "importing",
  "nav",
  "notifications",
  "search",
  /* The saved-views dialog: a register's search and filters under a name. */
  "views",
  "forbidden",
  "workshops",
] as const;

export type ClientNamespace = (typeof CLIENT_NAMESPACES)[number];

/**
 * The catalogue narrowed to what the browser will actually ask for.
 *
 * A namespace the catalogue does not have is skipped rather than shipped as
 * `undefined`: next-intl's provider validates what it is given, and an explicit
 * `undefined` is a different failure from an absent key — one that would report
 * as a malformed catalogue rather than as the missing namespace it is.
 */
export function clientMessages<T extends Record<string, unknown>>(all: T): Partial<T> {
  const picked: Record<string, unknown> = {};
  for (const namespace of CLIENT_NAMESPACES) {
    if (namespace in all) picked[namespace] = all[namespace];
  }
  return picked as Partial<T>;
}
