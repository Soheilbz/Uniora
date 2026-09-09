import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CAPABILITIES, type Capability } from "./capabilities.ts";
import { ALL_MODULES, MODULES } from "./modules.ts";

/**
 * Self-contained contract for the current application's navigation boundary.
 *
 * A checkout of this repository proves its own navigation and capability invariants.
 */

const APP = join(process.cwd(), "src", "app");

/** Whether a Next App Router path has a page/route in this repository. */
function routeExists(path: string): boolean {
  const segments = path.split("/").filter(Boolean);

  const walk = (directory: string, rest: readonly string[]): boolean => {
    if (!existsSync(directory)) return false;
    if (rest.length === 0) {
      if (existsSync(join(directory, "page.tsx")) || existsSync(join(directory, "route.ts"))) {
        return true;
      }
      // The root page itself may live inside a route group such as `(app)`.
      return readdirSync(directory)
        .filter((entry) => entry.startsWith("(") && entry.endsWith(")"))
        .some((entry) => walk(join(directory, entry), rest));
    }

    const [head, ...tail] = rest;
    if (!head) return false;

    const direct = join(directory, head);
    if (existsSync(direct) && walk(direct, tail)) return true;

    // Route groups such as `(app)` are present on disk but absent from the URL.
    return readdirSync(directory)
      .filter((entry) => entry.startsWith("(") && entry.endsWith(")"))
      .some((entry) => walk(join(directory, entry), rest));
  };

  return walk(APP, segments);
}

function requiredCapabilities(module: (typeof ALL_MODULES)[number]): readonly Capability[] {
  if (!module.capability) return [];
  return Array.isArray(module.capability) ? module.capability : [module.capability];
}

describe("module registry contract", () => {
  it("uses unique keys and paths", () => {
    const keys = ALL_MODULES.map((module) => module.key);
    const paths = ALL_MODULES.map((module) => module.path);
    expect(new Set(keys).size).toBe(keys.length);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it("defines valid absolute paths", () => {
    for (const module of ALL_MODULES) {
      expect(module.path.startsWith("/"), `${module.key} has an absolute path`).toBe(true);
      expect(
        module.path === "/" || !module.path.endsWith("/"),
        `${module.key} has no trailing slash`,
      ).toBe(true);
    }
  });

  it("serves every module exposed by this release", () => {
    const missing = MODULES.filter((module) => !routeExists(module.path)).map(
      (module) => module.path,
    );
    expect(missing, "exposed modules must have a page or route").toEqual([]);
  });

  it("references only capabilities from the closed capability vocabulary", () => {
    const known = new Set<string>(CAPABILITIES);
    const unknown = ALL_MODULES.flatMap((module) =>
      requiredCapabilities(module)
        .filter((capability) => !known.has(capability))
        .map((capability) => `${module.key}:${capability}`),
    );
    expect(unknown).toEqual([]);
  });
});
