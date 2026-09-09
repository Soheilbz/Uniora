import { and, eq, isNull, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { adminDb, setAdminTenantContext } from "@/db/admin.ts";
import { professors, tenants } from "@/db/schema.ts";
import { PAGE_SIZE, type RegisterQuery } from "@/lib/register/spec.ts";
import { readProfessors } from "./register.ts";

/**
 * The professor register's search — that it finds people, and that it can use
 * the index built for it.
 *
 * ── Why the plan is asserted and not just the result ────────────────────────
 *
 * A search that returns the right rows proves nothing about cost. The predicate
 * and the stored column have to describe *the same expression*, and when they
 * drift the search still works: PostgreSQL simply stops using the index and
 * reads every professor in the institution, folding six columns per row, on
 * every keystroke. Correct answers, and a directory that takes a second per
 * character to search once it holds a real university.
 *
 * That drift is invisible in a diff — somebody adds a column to the predicate,
 * or reformats the generated expression — and invisible in a result-only test.
 * So this asks the planner directly.
 *
 * `enable_seqscan = off` is not a way of faking the answer. A sequential scan is
 * genuinely cheaper on a table of four rows and PostgreSQL is right to pick it;
 * turning it off asks the question this test is actually about, which is whether
 * the index is *usable* by the predicate at all. An unusable index stays unused
 * with `enable_seqscan` off too — the plan just gets more expensive.
 */
const DATABASE = process.env.DATABASE_URL;

describe.skipIf(!DATABASE)("the professor register's search", () => {
  let tenantId: string;

  const base: RegisterQuery = {
    search: "",
    filters: {},
    sort: "name",
    direction: "asc",
    page: 1,
    size: PAGE_SIZE,
  };

  beforeAll(async () => {
    const [tenant] = await adminDb()
      .select({ id: tenants.id })
      .from(tenants)
      .where(eq(tenants.slug, "univ"))
      .limit(1);
    if (!tenant) throw new Error("seed the database first: pnpm seed");
    tenantId = tenant.id;
    await setAdminTenantContext(tenantId);
  });

  it("finds somebody by part of their family name", async () => {
    const [anybody] = await adminDb()
      .select({ lastName: professors.lastName })
      .from(professors)
      .where(and(eq(professors.tenantId, tenantId), isNull(professors.deletedAt)))
      .limit(1);
    expect(anybody).toBeDefined();
    if (!anybody) return;

    /* A prefix, not the whole name: the point of a trigram index over folded
       text is that an infix match is an index scan. */
    const needle = anybody.lastName.slice(0, 3);
    const page = await readProfessors(tenantId, { ...base, search: needle });
    expect(page.rows.some((row) => row.lastName === anybody.lastName)).toBe(true);
  });

  it("matches across the letterforms two keyboards produce", async () => {
    /*
     * «موسوي» with an Arabic yeh must find «موسوی» with a Persian one. This is
     * what `app.fold_text` is for on both sides of the comparison, and it is the
     * failure the stored column exists to prevent — folding the needle against
     * a raw column would mean a search typed on one keyboard never matching a
     * record filed from the other.
     */
    const persian = await readProfessors(tenantId, { ...base, search: "موسوی" });
    const arabic = await readProfessors(tenantId, { ...base, search: "موسوي" });
    expect(persian.rows.length).toBeGreaterThan(0);
    expect(arabic.rows.map((row) => row.id)).toEqual(persian.rows.map((row) => row.id));
  });

  it("narrows on every word, not on the phrase", async () => {
    /*
     * «سعید نظ» must find «سعید نظیفی». One needle containing a space cannot:
     * the folded column joins its parts with that same space in a fixed order,
     * and a two-word search is two words the reader expects to match anywhere.
     */
    const page = await readProfessors(tenantId, { ...base, search: "سعید نظ" });
    expect(page.rows.length).toBeGreaterThan(0);
    expect(page.rows.every((row) => row.lastName.startsWith("نظ"))).toBe(true);
  });

  it("keeps the predicate the trigram index can answer", async () => {
    const evidence = await adminDb().transaction(async (tx) => {
      await tx.execute(sql`set local enable_seqscan = off`);
      const index = await tx.execute(sql`
        select indexdef from pg_indexes
         where schemaname = 'public' and indexname = 'professors_search_idx'
      `);
      const plan = await tx.execute(sql`
        explain select id from professors
         where tenant_id = ${tenantId}
           and search_text like '%' || app.fold_text('نظیفی') || '%'
      `);
      return { index, plan };
    });

    const indexText = JSON.stringify(evidence.index.rows ?? evidence.index);
    const planText = JSON.stringify(evidence.plan.rows ?? evidence.plan);
    expect(indexText, "the deployed search index is trigram-backed").toContain(
      "USING gin (search_text gin_trgm_ops)",
    );
    expect(planText, "the plan keeps the folded LIKE predicate").toContain("search_text ~~");
    expect(planText, "the plan must not fall back to a sequential scan").not.toContain("Seq Scan");
  });
});
