import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import en from "@/messages/en.json";
import fa from "@/messages/fa.json";

/**
 * Every message key the screens name, against the catalogue.
 *
 * ── Why this is a source scan and not a list ────────────────────────────────
 *
 * The worksheets can be checked properly, because a form is *data* — the test
 * beside them walks the definitions. A settings page is markup, and its keys
 * are literals scattered through it, so the only list of what it uses is the
 * file itself. Scanning is crude, and it is the difference between finding
 * these at `pnpm test` and finding them when somebody opens the screen.
 *
 * ── What it caught ─────────────────────────────────────────────────────────
 *
 * Six keys, on the first run. A capability whose wording had been dropped while
 * the capability itself stayed in the closed list — so the roles screen threw
 * for everybody who opened it. And four messages carrying an ICU placeholder
 * that were being read without one, which `next-intl` does not degrade on: it
 * throws, and the section naming the key fails to render.
 *
 * Both are invisible to TypeScript, and neither shows up on whichever screen
 * the developer happens to have open.
 */

/**
 * Every screen, not just the settings.
 *
 * This began as a guard over the settings pages and it should have been over
 * all of them from the start: the reports shipped with a key that was both a
 * string and a namespace, and another read without the value its message takes
 * — the two exact faults this catches — because they were outside the scan.
 * The cost of widening it is a few milliseconds.
 */
const SCANNED = ["src/app", "src/components", "src/modules"];

/** Every `.ts`/`.tsx` file under the directories above, tests excluded. */
function sources(root: string): string[] {
  const found: string[] = [];
  const walk = (directory: string) => {
    for (const entry of readdirSync(directory)) {
      const path = join(directory, entry);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.tsx?$/.test(path) && !/\.test\.tsx?$/.test(path)) found.push(path);
    }
  };
  walk(root);
  return found;
}

/** A key a file names, and whether it was given substitution values. */
interface Reference {
  key: string;
  withValues: boolean;
}

/**
 * The keys a file names.
 *
 * Matched on the shapes these pages actually use — `t("key")`, `t("key", { … })`
 * and the namespaced translators the pages bind. A template literal is skipped
 * deliberately: `t(\`audit.entity.${type}\`)` names a key only known at run
 * time, and those already fall back to the raw value by design.
 */
function referencesIn(source: string): Reference[] {
  const found: Reference[] = [];
  const pattern = /\b(?:t|settings|importWords|capability)\(\s*"([^"]+)"\s*(,)?/g;

  for (const match of source.matchAll(pattern)) {
    const [, key, comma] = match;
    if (!key) continue;
    found.push({ key, withValues: comma !== undefined });
  }
  return found;
}

/**
 * Every message in a catalogue, by its full dotted path.
 *
 * Flattened rather than walked from a namespace, because a page binds its
 * translator to whatever depth suits it: the appearance screen binds `t` to
 * `settings.appearance` and names `brand.violet`, while the layout uses a root
 * translator and names `settings.subtitle`. Teaching the scanner each file's
 * binding would be a second list to keep in step with the first.
 */
function flatten(node: unknown, prefix: string, into: Map<string, string>) {
  if (typeof node === "string") {
    into.set(prefix, node);
    return;
  }
  if (typeof node !== "object" || node === null) return;
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    flatten(value, prefix === "" ? key : `${prefix}.${key}`, into);
  }
}

/** Every message whose path ends with this key. */
function candidates(messages: Map<string, string>, key: string): string[] {
  const found: string[] = [];
  for (const [path, message] of messages) {
    if (path === key || path.endsWith(`.${key}`)) found.push(message);
  }
  return found;
}

/**
 * The translators a file binds to a namespace it names outright.
 *
 * `const common = await getTranslations("common")` and its `useTranslations`
 * twin. Returns `binding -> namespace`, so `common("nationalId")` can be asked
 * about as `common.nationalId` *exactly*, rather than as «any path ending in
 * nationalId» — which the suffix check above cannot help being, because it has
 * no idea what any given `t` is bound to.
 *
 * Rootless bindings are deliberately absent from the map: `useTranslations()`
 * takes a whole path and is checked by the loose rule, which is the right
 * strength for it.
 */
function bindingsIn(source: string): Map<string, string> {
  const bound = new Map<string, string>();
  /*
   * A name bound twice to different namespaces is dropped rather than guessed
   * at. This file has no idea about scope: the appearance screen binds `t` to
   * `settings` in `generateMetadata` and to `settings.appearance` in the page
   * below it, and both are correct. Keeping whichever came last judged one of
   * them against the other's namespace and reported a screen that works.
   *
   * Those calls fall back to the loose suffix rule above, which is the right
   * strength when the namespace genuinely is not known.
   */
  const ambiguous = new Set<string>();

  /* The plain form: `const common = await getTranslations("common")`. */
  const direct =
    /const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:await\s+)?(?:getTranslations|useTranslations)\(\s*"([^"]+)"\s*\)/g;
  for (const match of source.matchAll(direct)) {
    const [, binding, namespace] = match;
    if (binding && namespace) remember(bound, ambiguous, binding, namespace);
  }

  /*
   * The form nearly every page here actually uses:
   *
   *   const [rows, t, common, nav] = await Promise.all([
   *     readThings(...),
   *     getTranslations("things"),
   *     getTranslations("common"),
   *   ]);
   *
   * Paired by position. Without this the check covered almost nothing — which
   * is not a theory: the first defect it was written for sat in exactly this
   * shape, and the direct pattern above walked straight past it.
   */
  for (const match of source.matchAll(/const\s+\[([^\]]*)\]\s*=\s*await\s+Promise\.all\(\[/g)) {
    /*
     * The names split at *depth zero*, not on every comma.
     *
     * A destructuring routinely opens with an object — `const [{ reading,
     * explanation }, lookups, t, common] = …` — and splitting naively makes
     * that one name into two, shifting every binding after it by one. The
     * result is a confident report that `common` is bound to `nav`, on a file
     * that is correct. This guard found exactly that in its own first run
     * against a new page.
     */
    const names = splitNames(match[1] ?? "");
    const from = (match.index ?? 0) + match[0].length;
    for (const [index, element] of splitTopLevel(source, from).entries()) {
      const named = /^(?:await\s+)?(?:getTranslations|useTranslations)\(\s*"([^"]+)"\s*\)$/.exec(
        element.trim(),
      );
      const binding = names[index];
      if (named?.[1] && binding && /^[A-Za-z_$][\w$]*$/.test(binding)) {
        remember(bound, ambiguous, binding, named[1]);
      }
    }
  }

  for (const binding of ambiguous) bound.delete(binding);
  return bound;
}

/** One binding, unless the file has already used that name for another namespace. */
function remember(
  bound: Map<string, string>,
  ambiguous: Set<string>,
  binding: string,
  namespace: string,
) {
  const already = bound.get(binding);
  if (already !== undefined && already !== namespace) ambiguous.add(binding);
  bound.set(binding, namespace);
}

/** A destructuring's names, split on its own commas rather than on every one. */
function splitNames(list: string): string[] {
  const names: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < list.length; index += 1) {
    const character = list[index];
    if (character === "{" || character === "[" || character === "(") depth += 1;
    else if (character === "}" || character === "]" || character === ")") depth -= 1;
    else if (character === "," && depth === 0) {
      names.push(list.slice(start, index).trim());
      start = index + 1;
    }
  }
  names.push(list.slice(start).trim());
  return names;
}

/**
 * A file with its comments blanked out, quotes respected.
 *
 * Needed before anything is split on commas: the prose in this codebase is
 * full of them — «a degree and a standing, so those two…» sat inside a
 * `Promise.all` array and split it into nine elements instead of six, which
 * paired every translator after it with the wrong namespace. Silently, and
 * confidently.
 *
 * Quote-aware, because a `//` inside a string is not a comment and blanking
 * from it would swallow the rest of the line. Comments are replaced by spaces
 * rather than removed so that every offset still lines up with the original.
 */
function stripComments(source: string): string {
  const out = source.split("");
  let index = 0;
  let quote: string | null = null;

  while (index < source.length) {
    const here = source[index];
    const next = source[index + 1];

    if (quote) {
      if (here === "\\") index += 1;
      else if (here === quote) quote = null;
      index += 1;
      continue;
    }
    if (here === '"' || here === "'" || here === "`") {
      quote = here;
      index += 1;
      continue;
    }
    if (here === "/" && next === "*") {
      const close = source.indexOf("*/", index + 2);
      const stop = close === -1 ? source.length : close + 2;
      for (let at = index; at < stop; at += 1) if (source[at] !== "\n") out[at] = " ";
      index = stop;
      continue;
    }
    if (here === "/" && next === "/") {
      let stop = source.indexOf("\n", index);
      if (stop === -1) stop = source.length;
      for (let at = index; at < stop; at += 1) out[at] = " ";
      index = stop;
      continue;
    }
    index += 1;
  }
  return out.join("");
}

/**
 * The elements of an array literal starting at `from`, split on its own commas.
 *
 * Depth-tracked rather than `split(",")`, because an element is routinely a
 * call with arguments of its own — `readWorkshops(viewer.tenantId, query)` —
 * and a naive split would shift every binding after it by one. That is worse
 * than not checking: it would report confident nonsense.
 */
function splitTopLevel(source: string, from: number): string[] {
  const elements: string[] = [];
  let depth = 0;
  let start = from;

  for (let index = from; index < source.length; index += 1) {
    const character = source[index];
    if (character === "(" || character === "[" || character === "{") depth += 1;
    else if (character === ")" || character === "}") depth -= 1;
    else if (character === "]") {
      if (depth === 0) {
        elements.push(source.slice(start, index));
        return elements;
      }
      depth -= 1;
    } else if (character === "," && depth === 0) {
      elements.push(source.slice(start, index));
      start = index + 1;
    }
  }
  return elements;
}

/**
 * Every `name("a.b")` call in a file, with the name that made it.
 *
 * A literal regex rather than one built per binding: the built version needed
 * `\b` and `\(` inside a template literal, where they are a backspace and a
 * bare paren, and it compiled to something that matched nothing while looking
 * exactly right. One pattern, and the binding is a capture like the key.
 */
function callsIn(source: string): { binding: string; key: string }[] {
  const found: { binding: string; key: string }[] = [];
  for (const match of source.matchAll(/\b([A-Za-z_$][\w$]*)\(\s*"([^"]+)"/g)) {
    if (match[1] && match[2]) found.push({ binding: match[1], key: match[2] });
  }
  return found;
}

const CATALOGUES = [
  ["fa", fa as unknown as Record<string, unknown>],
  ["en", en as unknown as Record<string, unknown>],
] as const;

describe("the screens", () => {
  const files = SCANNED.flatMap(sources);

  it("keeps the Persian and English catalogues structurally identical", () => {
    const faMessages = new Map<string, string>();
    const enMessages = new Map<string, string>();
    flatten(fa as unknown as Record<string, unknown>, "", faMessages);
    flatten(en as unknown as Record<string, unknown>, "", enMessages);

    expect([...enMessages.keys()].sort()).toEqual([...faMessages.keys()].sort());

    const placeholderMismatches: string[] = [];
    const placeholders = (message: string) =>
      [...message.matchAll(/\{([A-Za-z0-9_]+)\}/g)].map((match) => match[1]).sort();
    for (const [key, english] of enMessages) {
      const persian = faMessages.get(key);
      if (
        persian !== undefined &&
        placeholders(english).join("|") !== placeholders(persian).join("|")
      ) {
        placeholderMismatches.push(key);
      }
    }
    expect(placeholderMismatches).toEqual([]);
  });

  it("does not ship Persian prose in the English catalogue", () => {
    const enMessages = new Map<string, string>();
    flatten(en as unknown as Record<string, unknown>, "", enMessages);
    const leaked = [...enMessages]
      .filter(([, value]) => /[\u0600-\u06ff]/u.test(value))
      .map(([key]) => key);
    expect(leaked).toEqual([]);
  });

  it("scans the files it means to", () => {
    /* A scanner that silently found nothing would pass every test below. */
    expect(files.length).toBeGreaterThan(10);
    const seen = files.flatMap((file) => referencesIn(readFileSync(file, "utf8")));
    expect(seen.length).toBeGreaterThan(100);
  });

  for (const [locale, catalogue] of CATALOGUES) {
    const messages = new Map<string, string>();
    flatten(catalogue, "", messages);

    it(`name only keys the ${locale} catalogue holds`, () => {
      const missing: string[] = [];

      for (const file of files) {
        for (const reference of referencesIn(readFileSync(file, "utf8"))) {
          if (candidates(messages, reference.key).length === 0) {
            missing.push(`${file.replace(/\\/g, "/")}: ${reference.key}`);
          }
        }
      }

      expect(missing).toEqual([]);
    });

    it(`resolve exactly, for a translator bound to a named ${locale} namespace`, () => {
      /*
       * ── The gap the suffix check leaves open ──────────────────────────────
       *
       * The rule above asks whether *any* path ends with the key, because it
       * cannot tell what a given `t` is bound to. So `common("nationalId")`
       * passed: «کد ملی» exists — under `students.field`, which is not where
       * that call was looking. next-intl did not throw either; the workshop
       * participants export went out with the literal string
       * «common.nationalId» as a column heading.
       *
       * Where a file binds a translator to a namespace it *names*, there is no
       * ambiguity to be careful about, and the exact path can be demanded. That
       * covers most of the calls in this codebase.
       *
       * The other direction stays deliberately loose: a destructured translator
       * from `Promise.all`, a rootless one, a template key — none of them are in
       * the map, and none of them is reported here.
       */
      const missing: string[] = [];

      for (const file of files) {
        /* Comments blanked first — see `stripComments`. It also keeps a key
           merely *discussed* in prose from being read as a call. */
        const source = stripComments(readFileSync(file, "utf8"));
        const bound = bindingsIn(source);
        for (const { binding, key } of callsIn(source)) {
          const namespace = bound.get(binding);
          if (!namespace) continue;
          const path = `${namespace}.${key}`;
          if (!messages.has(path)) {
            missing.push(`${file.replace(/\\/g, "/")}: ${binding}("${key}") -> ${path}`);
          }
        }
      }

      expect(missing).toEqual([]);
    });

    it(`supply a value for every ${locale} message that takes one`, () => {
      /*
       * `next-intl` throws on an unsupplied placeholder rather than leaving it
       * in the string — so «حذف نقش «{name}»؟» read without values takes down
       * the section that names it.
       *
       * Flagged only when *every* message the key could name carries a
       * placeholder: a bare `title` matches a dozen paths and one of them
       * taking `{name}` says nothing about the one this page meant. The cases
       * that matter name exactly one message, so the conservative reading still
       * catches them and reports nothing it cannot stand behind.
       */
      const unfilled: string[] = [];

      for (const file of files) {
        for (const reference of referencesIn(readFileSync(file, "utf8"))) {
          if (reference.withValues) continue;
          const found = candidates(messages, reference.key);
          if (found.length > 0 && found.every((message) => /\{\w+\}/.test(message))) {
            unfilled.push(`${file.replace(/\\/g, "/")}: ${reference.key} — ${found[0]}`);
          }
        }
      }

      expect(unfilled).toEqual([]);
    });
  }
});
