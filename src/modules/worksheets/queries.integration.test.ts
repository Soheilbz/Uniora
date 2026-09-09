import { and, eq, isNull, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { adminDb, setAdminTenantContext } from "@/db/admin.ts";
import { councilDecisions, tenants } from "@/db/schema.ts";
import { SHEETS, sheetFields, signatureField } from "./catalogue.ts";
import { anyCase, findCases, readCase, readLetterhead, readPanelRegister } from "./queries.ts";

/**
 * The forms, against the table they read from.
 *
 * A form names its columns as strings, because that is what makes it data
 * rather than markup — and a string naming no column does not fail to compile,
 * it prints a ruled blank. On these sheets a blank under «استاد راهنمای دوم»
 * does not read as "not filled in"; it reads as "there is no second
 * supervisor", and the sheet is signed and filed on that reading. So the guard
 * has to be against the real table.
 */
describe.skipIf(!process.env.DATABASE_URL)("the worksheet queries", () => {
  let tenantId: string;
  let columns: Set<string>;

  beforeAll(async () => {
    const [tenant] = await adminDb()
      .select({ id: tenants.id })
      .from(tenants)
      .where(eq(tenants.slug, "univ"))
      .limit(1);
    if (!tenant) throw new Error("seed the database first: pnpm seed");
    tenantId = tenant.id;
    await setAdminTenantContext(tenantId);

    const found = await adminDb().execute(sql`
      select column_name from information_schema.columns
      where table_schema = 'public' and table_name = 'council_decisions'`);
    columns = new Set((found.rows as { column_name: string }[]).map((row) => row.column_name));
    expect(columns.size).toBeGreaterThan(20);
  });

  it("names a real column everywhere a form reads one", () => {
    const unknown: string[] = [];
    for (const sheet of SHEETS) {
      for (const field of sheetFields(sheet)) {
        if (!columns.has(field)) unknown.push(`${sheet.id}: ${field}`);
      }
      for (const section of sheet.sections) {
        for (const signature of section.signatures ?? []) {
          const field = signatureField(signature);
          if (field !== undefined && !columns.has(field)) {
            unknown.push(`${sheet.id} signature: ${field}`);
          }
        }
      }
    }
    expect(unknown).toEqual([]);
  });

  it("selects every column the forms read", async () => {
    /*
     * The read is a written-out column list rather than `select *`, so a form
     * that asks for a column the query does not fetch prints a blank — the same
     * silent failure, one layer down.
     */
    const record = await anyCase(tenantId);
    expect(record).not.toBeNull();
    if (!record) return;

    const fetched = new Set(Object.keys(record));
    const absent = [...new Set(SHEETS.flatMap((sheet) => sheetFields(sheet)))].filter(
      (field) => !fetched.has(field),
    );
    expect(absent).toEqual([]);
  });

  it("finds a case by the student name, and refuses to list the archive", async () => {
    const record = await anyCase(tenantId);
    if (!record?.student_name) throw new Error("seed the database first: pnpm seed");

    const surname = String(record.student_name).split(/\s+/).at(-1) ?? "";
    const { cases } = await findCases(tenantId, surname);
    expect(cases.length).toBeGreaterThan(0);
    expect(cases.some((row) => row.id === record.id)).toBe(true);

    /* An empty search draws nothing at all rather than the whole register: this
       screen is a search, and a list of every decision on file is not an
       answer to any question somebody at the counter has. */
    expect((await findCases(tenantId, "")).cases).toEqual([]);
    expect((await findCases(tenantId, "   ")).cases).toEqual([]);
  });

  it("reads one case and refuses a retired one", async () => {
    const record = await anyCase(tenantId);
    if (!record) throw new Error("seed the database first: pnpm seed");

    const again = await readCase(tenantId, String(record.id));
    expect(again?.student_name).toBe(record.student_name);
    expect(await readCase(tenantId, "01a02c24-0000-7000-8000-000000000000")).toBeNull();
  });

  it("answers with the rank and faculty the directory holds", async () => {
    const [record] = await adminDb()
      .select({ minuted: councilDecisions.primarySupervisor })
      .from(councilDecisions)
      .where(
        and(
          eq(councilDecisions.tenantId, tenantId),
          isNull(councilDecisions.deletedAt),
          sql`${councilDecisions.primarySupervisor} is not null and btrim(${councilDecisions.primarySupervisor}) <> ''`,
        ),
      )
      .limit(1);
    const minuted = String(record?.minuted ?? "").trim();
    if (!minuted) throw new Error("seed the database first: pnpm seed");
    const register = await readPanelRegister(tenantId, [minuted]);

    /*
     * The decisive property: the minutes write «دکتر X» and the directory holds
     * «X». A comparison that could not see past the honorific would report
     * every member of faculty as a guest examiner, and every rank and faculty
     * column on every form would print a rule.
     */
    expect(register.has(minuted)).toBe(true);
    expect(register.get(minuted)?.rank).not.toBe("");
  });

  it("rules a blank for a name the directory does not hold", async () => {
    const register = await readPanelRegister(tenantId, ["دکتر کسی که وجود ندارد"]);
    expect(register.size).toBe(0);
  });

  it("keys the answer by the name it was given, not by the folded form", async () => {
    /*
     * Two spellings of one person are two entries, each under what the minute
     * actually said — because that is what the sheet prints. Keyed by the fold,
     * a caller holding the minuted spelling could not look either of them up
     * without re-implementing `app.fold_person` in TypeScript, which is one
     * rule in two languages waiting to drift.
     */
    const [record] = await adminDb()
      .select({ minuted: councilDecisions.primarySupervisor })
      .from(councilDecisions)
      .where(
        and(
          eq(councilDecisions.tenantId, tenantId),
          isNull(councilDecisions.deletedAt),
          sql`${councilDecisions.primarySupervisor} is not null and btrim(${councilDecisions.primarySupervisor}) <> ''`,
        ),
      )
      .limit(1);
    const titled = String(record?.minuted ?? "").trim();
    if (!titled) throw new Error("seed the database first: pnpm seed");
    const plain = titled.replace(/^دکتر\s+/u, "");
    const register = await readPanelRegister(tenantId, [plain, titled]);

    expect(register.has(plain)).toBe(true);
    expect(register.has(titled)).toBe(true);
    expect(register.get(plain)).toEqual(register.get(titled));
  });

  it("names the institution the tenant is filed under", async () => {
    const letterhead = await readLetterhead(tenantId);
    expect(letterhead.named).toBe(true);
    expect(letterhead.name).not.toBe("");
  });
});
