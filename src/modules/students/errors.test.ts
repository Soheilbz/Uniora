import { describe, expect, it } from "vitest";
import en from "@/messages/en.json" with { type: "json" };
import fa from "@/messages/fa.json" with { type: "json" };
import { ERROR_KEYS } from "../../../test-support/student-error-keys.ts";

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

const catalogues = {
  fa: (fa as { errors: unknown }).errors,
  en: (en as { errors: unknown }).errors,
};

describe("error messages", () => {
  for (const [locale, catalogue] of Object.entries(catalogues)) {
    it(`resolves every key in ${locale}`, () => {
      for (const key of ERROR_KEYS) {
        const message = resolve(catalogue, key);
        expect(typeof message, `errors.${key} in ${locale}`).toBe("string");
        expect(message).not.toBe("");
      }
    });
  }

  it("has no catalogue entry that nothing can emit", () => {
    /*
     * The other direction. A message left behind after the rule that produced it
     * was removed is not a bug an operator ever sees, but it is a message a
     * translator spends time on and a reviewer reads as still reachable.
     */
    const leaves: string[] = [];
    const walk = (node: unknown, prefix: string) => {
      if (typeof node === "string") return leaves.push(prefix);
      if (node && typeof node === "object") {
        for (const [key, child] of Object.entries(node)) {
          walk(child, prefix ? `${prefix}.${key}` : key);
        }
      }
    };
    walk(catalogues.fa, "");
    expect([...leaves].sort()).toEqual([...ERROR_KEYS].sort());
  });
});

/**
 * The other direction: a message an action can actually return.
 *
 * ── The gap this closes ─────────────────────────────────────────────────────
 *
 * The checks above hold `ERROR_KEYS` and the two catalogues in step with each
 * other. Neither of them looks at the *source* — so an action returning
 * `{ ok: false, message: "professor.supervising" }` against a catalogue that had
 * never heard of it passed every one of them, and the refusal would have
 * rendered as the raw path «errors.professor.supervising» on the one screen, in
 * the one condition, that produces it.
 *
 * That is exactly how `text.nationalId` failed once already. This reads the
 * files.
 */
describe("every refusal an action can return", () => {
  /* Server Actions that report a whole-record failure rather than a field one. */
  const ACTION_ROOTS = ["src/modules", "src/lib"];

  /** Keys that are not error paths: a success message, a form-field code. */
  const NOT_A_REFUSAL = new Set([
    /* Successes, worded under their own screen's namespace. */
    "saved",
    "saveFailed",
    "signedOut",
    "sessionRevoked",
    "suspended",
    "reinstated",
    "passwordChanged",
    "passwordReset",
    "beyondYourLevel",
    "outranksYou",
    "valueRequired",
    "conflict",
    /* Domain-specific UI messages live in their feature namespace rather than
       under the shared validation catalogue. */
    "workshops.certificateRequiresAttendance",
    "workshops.certificateRequiresHeldWorkshop",
    "forbidden.title",
    "views.teamUnavailable",
    "workshops.registrationInvalidTransition",
    "workshops.registrationCapacityReached",
    "workshops.registrationAlreadyAttended",
    "workshops.certificateRequiresAttendance",
    "workshops.certificateRequiresHeldWorkshop",
    /* Field-level codes, which the form resolves against `errors.` itself and
       which the checks above already cover through `ERROR_KEYS`. */
    "number.invalid",
    "number.range",
    "record.conflict",
    "record.missing",
  ]);

  it("has a wording for it in both catalogues", async () => {
    const { readdirSync, readFileSync, statSync } = await import("node:fs");
    const { join } = await import("node:path");

    const files: string[] = [];
    const walk = (directory: string) => {
      for (const entry of readdirSync(directory)) {
        const path = join(directory, entry);
        if (statSync(path).isDirectory()) walk(path);
        else if (/\.tsx?$/.test(path) && !/\.test\.tsx?$/.test(path)) files.push(path);
      }
    };
    for (const root of ACTION_ROOTS) walk(root);

    const returned = new Set<string>();
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(/message:\s*"([a-z][a-zA-Z]*(?:\.[a-zA-Z]+)+)"/g)) {
        const key = match[1];
        if (key && !NOT_A_REFUSAL.has(key)) returned.add(key.replace(/^errors\./, ""));
      }
    }

    /* Guards the guard: a regex that matched nothing would pass silently. */
    expect(returned.size).toBeGreaterThan(0);

    for (const key of returned) {
      expect([...ERROR_KEYS], `"${key}" is registered in ERROR_KEYS`).toContain(key);
      for (const [locale, catalogue] of Object.entries(catalogues)) {
        expect(typeof resolve(catalogue, key), `errors.${key} in ${locale}`).toBe("string");
      }
    }
  });
});
