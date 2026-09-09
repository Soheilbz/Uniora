import { describe, expect, it } from "vitest";
import type { Capability } from "./capabilities";
import { can, type Viewer } from "./capabilities";
import { ALL_MODULES, MODULE_GROUPS, MODULES, moduleFor, modulesFor } from "./modules";

/*
 * Imported here rather than inside the test that uses it.
 *
 * `nav-main` is a client component and pulls its whole tree in behind it —
 * lucide, the sidebar primitives, the rest. Transforming that is seconds of
 * work, and inside a test body those seconds count against the five-second test
 * timeout: the suite passed alone and failed about one run in six under load,
 * with «Test timed out» pointing at an assertion that had not run yet. At module
 * scope the same work happens during collection, which is not on that clock.
 */
const { NAV_ICONS } = await import("@/components/shell/nav-main");

function viewer(...capabilities: Capability[]): Viewer {
  return {
    userId: "u",
    name: "n",
    tenantId: "t",
    capabilities,
    roleName: null,
    tier: 0,
    mustChangePassword: false,
    mfaEnabled: false,
    mfaVerified: false,
    requireMfa: false,
    tenantTimezone: "UTC",
    tenantPasswordMinLength: 12,
    isTenantOwner: false,
  };
}

describe("can", () => {
  it("requires every capability, not any of them", () => {
    /*
     * The defect this exists to prevent, and it is one the application
     * actually shipped. `reviewer-counts` reads the council register and the
     * professor register. Under "any", somebody holding only `council.view`
     * opens it and gets a screen where half the columns are empty for a reason
     * nothing on it explains — and, worse, the empty half is empty because
     * they were not allowed to see it, which the page does not say either.
     */
    const partial = viewer("council.view");
    expect(can(partial, "council.view")).toBe(true);
    expect(can(partial, "council.view", "professors.view")).toBe(false);
    expect(can(viewer("council.view", "professors.view"), "council.view", "professors.view")).toBe(
      true,
    );
  });

  it("is satisfied by an empty requirement", () => {
    // A module with no capability is open to anyone signed in — the dashboard.
    expect(can(viewer())).toBe(true);
  });
});

describe("modulesFor", () => {
  it("keeps ungated modules for a viewer with nothing", () => {
    const open = modulesFor(viewer());
    expect(open.map((module) => module.key)).toEqual(["dashboard", "settings"]);
  });

  it("withholds a module when only part of its requirement is held", () => {
    const keys = modulesFor(viewer("council.view")).map((module) => module.key);
    expect(keys).toContain("council-meetings");
    // Needs professors.view as well.
    expect(keys).not.toContain("reviewer-counts");
  });

  it("gives the full menu to a viewer holding everything", () => {
    const all = modulesFor(
      viewer(...new Set(MODULES.flatMap((module) => [module.capability ?? []].flat()))),
    );
    expect(all).toHaveLength(MODULES.length);
  });
});

describe("the registry itself", () => {
  it("has a unique key and a unique path per module", () => {
    expect(new Set(MODULES.map((m) => m.key)).size).toBe(MODULES.length);
    expect(new Set(MODULES.map((m) => m.path)).size).toBe(MODULES.length);
  });

  it("puts every module in a declared group", () => {
    /*
     * A module in a group `MODULE_GROUPS` does not list is a module that has a
     * route, passes its capability check, and never appears in the sidebar —
     * because the sidebar is built by walking the groups. It is reachable only
     * by typing the address, which is indistinguishable from a permission bug.
     */
    const declared = new Set(MODULE_GROUPS.map((group) => group.group));
    for (const module of MODULES) {
      expect(declared, `${module.key} is in group "${module.group}"`).toContain(module.group);
    }
  });

  it("resolves a module from its path, and nothing from an unknown one", () => {
    expect(moduleFor("/students")?.key).toBe("students");
    expect(moduleFor("/students/")).toBeUndefined();
    expect(moduleFor("/no-such-screen")).toBeUndefined();
  });
});

describe("the sidebar's icon map", () => {
  it("has an icon for every module, and no icon for a module that is gone", () => {
    /*
     * A Lucide icon is a function, and a function cannot cross from a Server
     * Component into a client one — so the registry keeps the icon and
     * `nav-main.tsx` keeps a second map from module key to the same icon.
     *
     * Two lists of the same twelve things drift. This is the check that they
     * have not: a module added to the registry and not to the map renders a menu
     * entry with a blank where its icon should be, which is easy to miss on a
     * screen where eleven other rows look right.
     */
    /* Against `ALL_MODULES`, not `MODULES`: a module this release withholds
       keeps its icon along with the rest of its definition, so that returning
       it is deleting one string and nothing else. */
    for (const module of ALL_MODULES) {
      expect(NAV_ICONS, `${module.key} has an icon`).toHaveProperty(module.key);
    }
    expect(Object.keys(NAV_ICONS).sort()).toEqual(ALL_MODULES.map((module) => module.key).sort());
  });
});
