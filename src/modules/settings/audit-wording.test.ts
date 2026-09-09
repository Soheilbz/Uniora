import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import en from "@/messages/en.json" with { type: "json" };
import fa from "@/messages/fa.json" with { type: "json" };

/**
 * Every event this build files has a word for it in both catalogues.
 *
 * ── Why this is a test and not a review habit ───────────────────────────────
 *
 * An audit entry is written by a Server Action and read on a screen nobody
 * looks at until somebody is asking a question about what happened. The two
 * ends are a string literal apart: `entityType: "calendar_entry"` in one file,
 * `audit.entity.calendar_entry` in a catalogue in another, and nothing connects
 * them. A new register is added, its actions log against a new type, and the
 * gap is invisible until an auditor prints the log.
 *
 * Which is exactly how it was found. `calendar_entry` and
 * `council_permanent_member` were both being filed against catalogues that
 * carried neither, and the miss printed as the untranslated path —
 * «settings.audit.entity.calendar_entry» — in a column of otherwise ordinary
 * Persian, on a sheet meant for an auditor.
 *
 * The wordings are checked in *both* languages, because a catalogue is
 * translated by hand and the second one is the one that gets forgotten.
 */

const SOURCE = "src";

function sourceFiles(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      found.push(...sourceFiles(path));
    } else if (path.endsWith(".ts") || path.endsWith(".tsx")) {
      found.push(path);
    }
  }
  return found;
}

/** Every `entityType: "…"` literal the application writes. */
function loggedTypes(): Map<string, string[]> {
  const types = new Map<string, string[]>();
  for (const file of sourceFiles(SOURCE)) {
    if (file.endsWith(".test.ts") || file.endsWith(".test.tsx")) continue;
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(/entityType:\s*"([a-z_]+)"/g)) {
      const type = match[1];
      if (!type) continue;
      types.set(type, [...(types.get(type) ?? []), file]);
    }
  }
  return types;
}

/** Every action literal that can be written to the tenant audit log. */
function loggedActions(): Set<string> {
  const actions = new Set<string>();
  for (const file of sourceFiles(SOURCE)) {
    if (file.endsWith(".test.ts") || file.endsWith(".test.tsx")) continue;
    const source = readFileSync(file, "utf8");
    const writesAudit = /write(?:Auth)?AuditEvent\s*\(|insert\(auditLog\)/.test(source);

    /* Read the whole action expression up to `entityType`, not just one quoted
       literal. This catches conditional expressions such as role create/update
       as well as ordinary literals. */
    if (writesAudit) {
      for (const match of source.matchAll(/action:\s*([\s\S]{0,180}?)\s*,\s*\n\s*entityType:/g)) {
        const expression = match[1] ?? "";
        for (const literal of expression.matchAll(/"([a-z_.]+)"/g)) {
          if (literal[1]) actions.add(literal[1]);
        }
      }
    }

    /* Security failures are deliberately funnelled through one helper whose
       `action` parameter is dynamic at the insert site. The call-site literal
       is still part of the audit contract and must have wording too. */
    for (const match of source.matchAll(
      /recordSecurityFailure\([\s\S]{0,360}?"(auth\.[a-z_.]+)"\s*,?\s*\)/g,
    )) {
      if (match[1]) actions.add(match[1]);
    }
  }
  return actions;
}

const CATALOGUES = { fa, en } as Record<string, unknown>;

function wording(catalogue: unknown, path: string): unknown {
  let node = catalogue;
  for (const part of path.split(".")) {
    if (typeof node !== "object" || node === null) return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return node;
}

describe("the event log's wording", () => {
  const types = loggedTypes();
  const actions = loggedActions();

  it("files against at least one entity type", () => {
    /* Guards the guard: a regex that matched nothing would let every check
       below pass over an empty set. */
    expect(types.size).toBeGreaterThan(5);
    expect(actions.size).toBeGreaterThan(0);
  });

  for (const language of ["fa", "en"]) {
    it(`names every logged entity in the ${language} catalogue`, () => {
      const missing: string[] = [];
      for (const [type, files] of types) {
        const said = wording(CATALOGUES[language], `settings.audit.entity.${type}`);
        if (typeof said !== "string") missing.push(`${type} (${files[0]})`);
      }
      expect(missing).toEqual([]);
    });

    it(`names every logged action in the ${language} catalogue`, () => {
      const missing: string[] = [];
      for (const action of actions) {
        const said = wording(CATALOGUES[language], `settings.audit.action.${action}`);
        if (typeof said !== "string") missing.push(action);
      }
      expect(missing).toEqual([]);
    });
  }
});
