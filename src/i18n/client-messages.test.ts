import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import en from "@/messages/en.json" with { type: "json" };
import fa from "@/messages/fa.json" with { type: "json" };
import { CLIENT_NAMESPACES, clientMessages } from "./client-messages.ts";

/**
 * The list of namespaces the browser gets, checked against the source.
 *
 * ── Why a machine has to ask this ───────────────────────────────────────────
 *
 * `CLIENT_NAMESPACES` is a hand-written list standing in for a fact about the
 * code — which namespaces a `"use client"` component reads — and a hand-written
 * list standing in for a fact goes stale. It goes stale in two directions and
 * both cost something:
 *
 *  - a namespace *missing* from it is a client component that throws the first
 *    time somebody opens the dialog it lives in. Loud, but loud in production
 *    rather than in review;
 *  - a namespace *left* in it after its last client reader was deleted is dead
 *    weight in the payload of every page, and nothing anywhere fails. That is
 *    the direction this whole change exists to fix, so leaving the door open to
 *    it would be pointless.
 *
 * So the list is not trusted. Both directions are read out of the files.
 */

/** Walks `a.b.c` through a nested catalogue the way next-intl does. */
function resolve(catalogue: unknown, path: string): unknown {
  return path
    .split(".")
    .reduce<unknown>(
      (node, part) =>
        node && typeof node === "object" ? (node as Record<string, unknown>)[part] : undefined,
      catalogue,
    );
}

/** Every `"use client"` file, which is the only kind that resolves in the browser. */
function clientFiles(): { path: string; source: string }[] {
  const found: { path: string; source: string }[] = [];

  const walk = (directory: string) => {
    for (const entry of readdirSync(directory)) {
      const path = join(directory, entry);
      if (statSync(path).isDirectory()) {
        walk(path);
        continue;
      }
      if (!/\.tsx?$/.test(path) || /\.test\.tsx?$/.test(path)) continue;
      const source = readFileSync(path, "utf8");
      /* The directive has to be the first thing in the file for React to honour
         it, so it is matched at the start rather than anywhere. */
      if (/^\s*["']use client["']/.test(source)) found.push({ path, source });
    }
  };

  for (const root of ["src/app", "src/components", "src/modules", "src/lib"]) walk(root);
  return found;
}

/**
 * Namespaces asked for by name — `useTranslations("council")`.
 *
 * The rootless form, `useTranslations()`, asks for nothing in particular and is
 * handled by the refusal check further down instead.
 */
function namespacesAskedFor(): Map<string, string[]> {
  const asked = new Map<string, string[]>();
  for (const { path, source } of clientFiles()) {
    for (const match of source.matchAll(/useTranslations\(\s*["']([^"']+)["']\s*\)/g)) {
      /* A nested namespace such as "reports.month" is shipped by its root: that
         is the key the provider is given, and the sub-object rides along. */
      const root = (match[1] ?? "").split(".")[0] ?? "";
      if (!root) continue;
      asked.set(root, [...(asked.get(root) ?? []), path]);
    }
  }
  return asked;
}

describe("the namespaces that cross into the browser", () => {
  it("finds client components to read, so a silent pass is not possible", () => {
    /* Guards the guard. A walk that matched nothing — a moved directory, a
       changed directive — would make every assertion below vacuously true. */
    const files = clientFiles();
    expect(files.length).toBeGreaterThan(10);
    expect(namespacesAskedFor().size).toBeGreaterThan(5);
  });

  it("ships every namespace a client component asks for by name", () => {
    for (const [namespace, users] of namespacesAskedFor()) {
      expect(
        [...CLIENT_NAMESPACES],
        `"${namespace}" is read by ${users[0]} and must be in CLIENT_NAMESPACES`,
      ).toContain(namespace);
    }
  });

  it("ships nothing a client component has stopped asking for", () => {
    /*
     * The direction nothing else would catch. `errors` and `council` are the
     * two that no `useTranslations("…")` need account for: they are reached
     * through the rootless translator in the roster, substitutions and
     * bulk-edit dialogs, which render whatever catalogue path a Server Action
     * returns. The check below is what holds *those* two to something real.
     */
    const asked = namespacesAskedFor();
    const throughRefusals = new Set(["errors", "council", "forbidden"]);
    for (const namespace of CLIENT_NAMESPACES) {
      const reached = asked.has(namespace) || throughRefusals.has(namespace);
      expect(
        reached,
        `"${namespace}" is in CLIENT_NAMESPACES but nothing client-side reads it`,
      ).toBe(true);
    }
  });

  it("ships every namespace a refusal can name", () => {
    /*
     * The rootless translator, from the other end.
     *
     * Three dialogs call `useTranslations()` with no namespace so that a Server
     * Action can hand back any catalogue path and have it rendered — which
     * means the set of namespaces they can reach is decided in the *actions*,
     * not in the components. A refusal worded under a namespace the browser was
     * not given renders as a thrown error on the one screen, in the one
     * condition, that produces it.
     *
     * Two shapes carry a path: the whole-record `message:` and the field-level
     * `errors: { field: "…" }`. A key whose first segment is not a namespace of
     * its own is a bare code the form resolves under `errors` itself — see
     * `src/modules/students/errors.test.ts`, which is the guard on those.
     */
    const catalogue = fa as Record<string, unknown>;
    const named = new Set<string>();

    const walk = (directory: string) => {
      for (const entry of readdirSync(directory)) {
        const path = join(directory, entry);
        if (statSync(path).isDirectory()) {
          walk(path);
          continue;
        }
        if (!/\.tsx?$/.test(path) || /\.test\.tsx?$/.test(path)) continue;
        const source = readFileSync(path, "utf8");

        for (const match of source.matchAll(/message:\s*"([a-zA-Z]+(?:\.[a-zA-Z]+)+)"/g)) {
          named.add(match[1] as string);
        }
        /* `errors: { memberName: "council.roster.duplicate" }` — the field-level
           form, which is how the roster's duplicate seat is worded. */
        for (const block of source.matchAll(/\berrors:\s*\{([^}]*)\}/g)) {
          for (const value of (block[1] ?? "").matchAll(/:\s*"([a-zA-Z]+(?:\.[a-zA-Z]+)+)"/g)) {
            named.add(value[1] as string);
          }
        }
      }
    };
    for (const root of ["src/modules", "src/lib"]) walk(root);

    expect(named.size, "the scan found refusal keys").toBeGreaterThan(0);

    for (const key of named) {
      /*
       * Resolved, not guessed from the first segment.
       *
       * «record.conflict» is a bare field code that the form looks up under
       * `errors` — and `record` is *also* a namespace of its own, for the
       * record pages. Asking whether the head is a namespace says «ship
       * record»; asking whether the whole path resolves says what is true.
       */
      const atRoot = resolve(catalogue, key);
      const underErrors = resolve(catalogue, `errors.${key}`);
      const namespace = typeof atRoot === "string" ? (key.split(".")[0] as string) : "errors";
      expect(
        typeof atRoot === "string" ? atRoot : underErrors,
        `a refusal can return "${key}", but nothing in the catalogue answers to it`,
      ).toBeTypeOf("string");
      expect(
        [...CLIENT_NAMESPACES],
        `a refusal can return "${key}", so "${namespace}" must reach the browser`,
      ).toContain(namespace);
    }
  });

  it("picks exactly those namespaces out of both catalogues", () => {
    for (const [locale, all] of Object.entries({ fa, en })) {
      const picked = clientMessages(all as Record<string, unknown>);
      expect(Object.keys(picked).sort(), `${locale} carries every listed namespace`).toEqual(
        [...CLIENT_NAMESPACES].sort(),
      );
      for (const namespace of CLIENT_NAMESPACES) {
        expect(picked[namespace], `${locale}.${namespace} is not empty`).toBeTruthy();
      }
    }
  });

  it("leaves the largest server-only namespaces on the server", () => {
    /*
     * Named rather than measured, because this is the point of the exercise:
     * `settings` and `sheet` are 20 KB apiece and `reports` is 9 KB, and all
     * three render entirely on the server. If one of them ever has to ship, it
     * should be a decision somebody makes here rather than something that
     * happens to a payload.
     */
    for (const namespace of ["settings", "sheet", "reports"]) {
      expect([...CLIENT_NAMESPACES], `"${namespace}" renders on the server`).not.toContain(
        namespace,
      );
    }
  });
});
