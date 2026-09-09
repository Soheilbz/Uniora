import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { adminDb, setAdminTenantContext } from "@/db/admin.ts";
import { tenants } from "@/db/schema.ts";
import { ADMINISTRATOR_TIER, CAPABILITIES, type Viewer } from "@/lib/capabilities.ts";
import { readAttention } from "./queries.ts";
import { attentionFailed, attentionSignals } from "./rules.ts";

/**
 * The counts, against a real PostgreSQL.
 *
 * ── Why this cannot be a unit test ──────────────────────────────────────────
 *
 * `readAttention` catches its own failure and reports «not counted», because it
 * runs in the shell and a broken count must not take down the page a reader
 * actually asked for. That is right, and it means a broken statement is
 * *invisible*: the application renders, the bell renders, every figure is a
 * dash, and nothing anywhere says the SQL is wrong.
 *
 * `current_date + ${DAYS}` sends the horizon as a bound parameter; a bound
 * parameter arrives untyped, and PostgreSQL
 * cannot choose between `date + integer` and `date + interval` — so it refused
 * the whole statement with «operator is not unique». TypeScript saw nothing
 * wrong. A psql transcript saw nothing wrong either, because a `7` typed by
 * hand is an integer literal and works.
 *
 * The only thing that catches it is running it. That is this file.
 */

const DATABASE = process.env.DATABASE_URL;

describe.skipIf(!DATABASE)("the attention counts", () => {
  let viewer: Viewer;

  beforeAll(async () => {
    const [tenant] = await adminDb()
      .select({ id: tenants.id })
      .from(tenants)
      .where(eq(tenants.slug, "univ"))
      .limit(1);
    if (!tenant) throw new Error("seed the database first: pnpm seed");
    await setAdminTenantContext(tenant.id);

    /*
     * Entitled to everything, so no signal is skipped for want of a capability
     * and the whole statement is exercised.
     *
     * Built to the real Viewer type so capability evaluation is exercised with
     * the same data shape the application uses.
     */
    viewer = {
      userId: "test",
      name: "test",
      tenantId: tenant.id,
      capabilities: [...CAPABILITIES],
      roleName: null,
      tier: ADMINISTRATOR_TIER,
      mustChangePassword: false,
      mfaEnabled: true,
      mfaVerified: true,
      requireMfa: true,
      tenantTimezone: "UTC",
      tenantPasswordMinLength: 12,
      isTenantOwner: false,
    };
  });

  it("answers, rather than falling back to «not counted»", async () => {
    const counts = await readAttention(viewer);

    /*
     * The assertion the fallback hides. Every group reports `ready`, which is
     * only true if the statement ran — and it is what a refused statement
     * cannot fake, because the `catch` returns `ready: false` throughout.
     */
    expect(counts.council.ready, "the council counts answered").toBe(true);
    expect(counts.students.ready, "the student counts answered").toBe(true);
    expect(counts.workshops.ready, "the workshop counts answered").toBe(true);
    expect(counts.calendar.ready, "the diary counts answered").toBe(true);

    expect(attentionFailed(attentionSignals(counts))).toBe(false);
  });

  it("returns numbers, not the strings a bigint arrives as", async () => {
    const counts = await readAttention(viewer);

    /*
     * `count(*)` is a bigint and node-postgres hands a 64-bit integer over as a
     * string rather than narrowing it. Declared `number` and left unconverted,
     * `count > 0` is `"0" > 0` — false — so a real backlog would never raise,
     * and any arithmetic on it would concatenate.
     */
    for (const [name, value] of [
      ["pendingTotal", counts.council.pendingTotal],
      ["defencesSoon", counts.council.defencesSoon],
      ["defencesIncomplete", counts.council.defencesIncomplete],
      ["sittingsSoon", counts.council.sittingsSoon],
      ["unsupervised", counts.students.unsupervised],
      ["withoutInstructor", counts.workshops.withoutInstructor],
      ["upcoming", counts.calendar.upcoming],
    ] as const) {
      expect(typeof value, `${name} is a number`).toBe("number");
      expect(Number.isFinite(value), `${name} is finite`).toBe(true);
    }
  });

  it("agrees with the register about what the council still owes", async () => {
    /*
     * The bell and the decisions register count the same backlog from the same
     * list of states — `AWAITING_REVIEW` — so a second spelling of «still in
     * front of the council» would show up here as two different numbers.
     */
    const counts = await readAttention(viewer);
    const [row] = (
      await adminDb().execute(
        `select count(*)::int as total from council_decisions
          where deleted_at is null and review_status in ('pending', 're_review')`,
      )
    ).rows as { total: number }[];

    expect(counts.council.pendingTotal).toBe(row?.total);
  });

  it("names the sitting the oldest unreviewed decision came from", async () => {
    const counts = await readAttention(viewer);
    /* The seeded review-status cycle deliberately includes pending/re-review
       cases. Returning early here would let the test go green if that backlog
       query regressed to zero, which is exactly the failure this assertion is
       supposed to expose. */
    expect(
      counts.council.pendingTotal,
      "the seed contains an unreviewed council backlog",
    ).toBeGreaterThan(0);

    /* Both halves of the hint, or neither: the wording reads «oldest from
       sitting X — N days», and half of that is a sentence with a hole in it. */
    expect(counts.council.oldestMeeting).not.toBeNull();
    expect(counts.council.oldestDays).not.toBeNull();
    expect(counts.council.oldestDays ?? -1).toBeGreaterThanOrEqual(0);
  });
});
