import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { checkDatabasePrivilegeContract } from "./checks/database-privilege-contract.mjs";

/**
 * The boundaries that are invisible in a diff.
 *
 * Every rule here describes something that is correct today, that nothing in the
 * type system or the linter can hold in place, and whose breach would not look
 * like a bug — it would look like a working feature. That is the whole selection
 * criterion: a mistake the tests would pass.
 *
 * Run by `pnpm check`, and in CI before anything is deployed.
 */

const ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      yield* walk(path);
      continue;
    }
    if (/\.(ts|tsx|mts|mjs)$/.test(path)) yield path;
  }
}

const failures = [];

function check({ name, why, roots, forbid, allow = () => false }) {
  for (const root of roots) {
    let files;
    try {
      files = [...walk(join(ROOT, root))];
    } catch {
      continue; // A directory that does not exist yet is not a violation.
    }
    for (const file of files) {
      const rel = relative(ROOT, file).split(sep).join("/");
      if (allow(rel)) continue;
      const source = readFileSync(file, "utf8");
      for (const pattern of forbid) {
        if (pattern.test(source)) {
          failures.push({ name, why, file: rel, pattern: String(pattern) });
        }
      }
    }
  }
}

/*
 * ── 1. The owning role never serves a request ────────────────────────────────
 *
 * `adminDb()` connects as `univ`, which owns the schema and bypasses row-level
 * security. It exists for migrations and the seeder. If a page, a layout, a
 * component or a Server Action ever imports it, every policy in
 * `db/policies` stops applying to that code path — and the symptom is not an
 * error. It is a page that works, returns data, and returns *every university's*
 * data. Nothing about that reads as wrong in review.
 */
check({
  name: "admin connection out of the request path",
  why: "adminDb() bypasses row-level security; a request served through it sees every tenant",
  roots: ["src/app", "src/components", "src/lib", "src/modules"],
  forbid: [/from\s+["'][^"']*db\/admin(\.ts)?["']/, /require\(["'][^"']*db\/admin/],
  /*
   * An integration test may connect as the owner, and only an integration test.
   *
   * The rule is about *requests*: a page served through the owning role returns
   * every university's rows and looks entirely correct doing it. A test is not a
   * request — it is never imported by the application, it runs against a seeded
   * database, and seeding the fixture it needs is exactly what the owning role
   * is for.
   *
   * Narrow on purpose. `*.test.ts` alone would exempt the unit tests too, and a
   * unit test reaching for a database connection is a different mistake worth
   * keeping visible.
   */
  allow: (file) => file.endsWith(".integration.test.ts"),
});

/*
 * ── 2. Institutional reads go through the tenant boundary ────────────────────
 *
 * `db()` on its own is scoped by nothing. The policies then refuse it — the
 * function raises rather than returning an empty set, deliberately — so this is
 * a loud failure rather than a silent leak. The check is here anyway, because
 * "loud failure in production" and "caught before merge" are different things.
 */
check({
  name: "raw db() outside the tenant helpers",
  why: "reads must go through withTenant()/readOnly(), which set the tenant for the transaction",
  roots: ["src/app", "src/components"],
  forbid: [/\bdb\(\)\s*\.\s*(select|insert|update|delete|execute)/],
  /*
   * The healthcheck is the one legitimate exception.
   *
   * `api/healthz` runs `select 1` — it names no table, so there is nothing a
   * tenant context could scope, and wrapping a liveness probe in a transaction
   * would only make it heavier. The file is named exactly; anything else that
   * wants out of this rule has to argue its case here too.
   */
  allow: (file) => file === "src/app/api/healthz/route.ts",
});

/*
 * ── 2b. Tenant queries do not become Server Actions by accident ────────────
 *
 * A module marked `"use server"` is an endpoint boundary: its exported async
 * functions may be invoked from a browser. A read helper that accepts a
 * caller-supplied tenantId is therefore an easy way to turn an internal query
 * into a cross-tenant probe, even if the query itself uses RLS correctly. Keep
 * read-only modules separate from action modules; this catches the regression
 * before it reaches the compiler.
 */
{
  const label = "tenant-scoped read exported from a Server Action module";
  const why =
    "read helpers with tenantId belong in a non-action query module, not in a public Server Action boundary";
  const actionRoots = ["src/app/actions", "src/lib", "src/modules"];

  for (const root of actionRoots) {
    let files;
    try {
      files = [...walk(join(ROOT, root))];
    } catch {
      continue;
    }
    for (const file of files) {
      const rel = relative(ROOT, file).split(sep).join("/");
      const source = readFileSync(file, "utf8");
      if (!/^\s*["']use server["'];/m.test(source)) continue;
      const match =
        /export async function\s+(read|find|list|offered|current)[A-Z]\w*\s*\([^)]*\btenantId\b/.exec(
          source,
        );
      if (match) {
        failures.push({ name: label, why, file: rel, pattern: match[0] });
      }
    }
  }
}

/*
 * ── 2c. App routes render/orchestrate; domain modules own persistence ──────
 *
 * A page importing the schema or tenant transaction helper becomes a second
 * data-access layer. That is how authorization, export limits and query shapes
 * drift apart. The application shell may call modules; it does not own SQL.
 */
check({
  name: "application route bypasses the domain data layer",
  why: "pages/routes under the authenticated app must call module readers/actions rather than importing db/schema or db/tenant",
  roots: ["src/app/(app)"],
  forbid: [/from\s+["'][^"']*db\/schema(?:\.ts)?["']/, /from\s+["'][^"']*db\/tenant(?:\.ts)?["']/],
});

/*
 * ── 2d. The generic register layer is not a student subsystem ──────────────
 *
 * Shared field contracts and directory references live below the domains. A
 * professor/council module importing student field/action/record internals is
 * architectural coupling even when TypeScript accepts it.
 */
check({
  name: "cross-domain dependency on student register internals",
  why: "generic register, professor and council code must use shared register/directory contracts instead of student-owned abstractions",
  roots: [
    "src/lib/register",
    "src/components/engine",
    "src/modules/professors",
    "src/modules/council",
  ],
  forbid: [/@\/modules\/students\/(?:fields|actions|record|validation)(?:\.ts)?/],
});

/*
 * ── 2e. The split database schema has one public import surface ─────────────
 *
 * Domain schema files are an implementation detail of the schema package.
 * Keeping callers on `@/db/schema.ts` means those files can move or be split
 * again without leaking database-module layout through the application.
 */
check({
  name: "database schema internal imported directly",
  why: "application code must import the public @/db/schema.ts barrel, not a domain schema implementation file",
  roots: ["src/app", "src/components", "src/lib", "src/modules", "src/db"],
  forbid: [/@\/db\/schema\//],
  allow: (file) => file.startsWith("src/db/schema/"),
});

/*
 * ── 3. A menu group label stays inside its group ─────────────────────────────
 *
 * Base UI's `Menu.GroupLabel` reads a context only `<Menu.Group>` provides and
 * *throws* without one. That is a runtime error inside a popup, which means it
 * is invisible everywhere a mistake normally shows up: a menu's contents are not
 * rendered until somebody opens it, so it survives the type checker, the whole
 * test suite and every server render, and then takes the page down the first
 * time a person clicks the button.
 *
 * It shipped exactly that way here — the column picker on every register and the
 * account menu in the sidebar both went down on open, for weeks, because nothing
 * anywhere had cause to build the element.
 */
{
  const label = "menu group label outside its group";
  const why =
    "Base UI's Menu.GroupLabel throws without a <Menu.Group> around it, and only when the popup opens";

  for (const root of ["src/app", "src/components", "src/modules"]) {
    let files;
    try {
      files = [...walk(join(ROOT, root))];
    } catch {
      continue;
    }
    for (const file of files) {
      const rel = relative(ROOT, file).split(sep).join("/");
      if (rel.endsWith("ui/dropdown-menu.tsx")) continue; // where it is defined
      const source = readFileSync(file, "utf8");
      if (!source.includes("DropdownMenuGroupLabel")) continue;
      /* Crude on purpose: the label has to appear *after* an opening group tag
         somewhere in the file. A file that uses one and never opens the other
         cannot be right. */
      if (!source.includes("<DropdownMenuGroup>") && !source.includes("<DropdownMenuGroup ")) {
        failures.push({ name: label, why, file: rel, pattern: "DropdownMenuGroupLabel" });
      }
    }
  }
}

/**
 * One way to keep a thing off paper.
 *
 * `globals.css` hides `[data-print-hide]` from an *unlayered* `@media print`
 * rule, and the comment there explains why the selector is an attribute and not
 * an element name: the version that read `header` hid the letterhead at the top
 * of every minute, and printing one produced a document with no title on it.
 *
 * Tailwind's `print:hidden` does the same job from inside `@layer utilities`,
 * so both work today — which is the problem. Two spellings for one rule means
 * somebody reads that comment, greps for `data-print-hide`, and concludes the
 * minute's breadcrumbs print when they do not; or writes the unlayered rule for
 * a case the layered one loses. The three document screens are exactly where
 * that guess is expensive.
 *
 * `print:block` is left alone — it *reveals* rather than hides, so it has no
 * attribute counterpart and no rule to disagree with.
 */
{
  const label = "two spellings for print-hiding";
  const why =
    "use data-print-hide — globals.css hides it unlayered, and print:hidden is the second spelling of the same rule";

  for (const root of ["src/app", "src/components", "src/modules"]) {
    let files;
    try {
      files = [...walk(join(ROOT, root))];
    } catch {
      continue;
    }
    for (const file of files) {
      const rel = relative(ROOT, file).split(sep).join("/");
      const source = readFileSync(file, "utf8");
      if (source.includes("print:hidden")) {
        failures.push({ name: label, why, file: rel, pattern: "print:hidden" });
      }
    }
  }
}

/*
 * ── 4b. Inactive-tenant bypass exists only during initial provisioning ─────
 *
 * Normal tenant transactions reject suspended, archived and incompletely
 * provisioned universities in `withTenant()`. The one explicit bypass is needed
 * while create-tenant is installing the initial role and owner before the tenant
 * becomes active. The platform registry is the one read-only application
 * exception: its operator view must be able to show suspended and archived
 * universities without opening a tenant data path. Letting ordinary requests
 * opt into it would defeat the lifecycle boundary for the entire application.
 */
{
  const label = "inactive tenant bypass outside provisioning";
  const why =
    "allowInactive may only be used by provisioning or the read-only platform registry; ordinary application code must respect tenant lifecycle";
  for (const root of ["src", "scripts"]) {
    let files;
    try {
      files = [...walk(join(ROOT, root))];
    } catch {
      continue;
    }
    for (const file of files) {
      const rel = relative(ROOT, file).split(sep).join("/");
      if (
        rel === "src/db/tenant.ts" ||
        rel === "src/modules/platform/queries.ts" ||
        rel === "src/modules/platform/tenant-queries.ts" ||
        rel === "src/modules/platform/break-glass.ts" ||
        rel === "src/modules/platform/operations.ts" ||
        rel === "scripts/create-tenant.ts" ||
        rel === "scripts/check-boundaries.mjs"
      )
        continue;
      const source = readFileSync(file, "utf8");
      if (/allowInactive\s*:\s*true/.test(source)) {
        failures.push({ name: label, why, file: rel, pattern: "allowInactive: true" });
      }
    }
  }
}

/*
 * ── 5. Web runtime never receives platform credentials ─────────────────────
 *
 * The platform owner connection can cross every tenant boundary. Keep it out
 * of the two Web environment templates and out of the `dev` command itself;
 * database/provisioning commands deliberately load the separate privileged
 * file. This turns an operational convention into a CI-enforced boundary.
 */
{
  const label = "platform credential outside the web runtime";
  const why =
    "owner/backup credentials belong to .env.database.local or .env.operations, never the Next.js process";
  const webTemplates = [".env.example", ".env.production.example"];
  const privileged = [
    "DATABASE_ADMIN_URL",
    "APP_DB_PASSWORD",
    "BACKUP_ENCRYPTION_KEY",
    "BACKUP_DIR",
    "BACKUP_OFFSITE_DIR",
    "PLATFORM_OPERATOR",
    "PLATFORM_RESTORE_ALLOWED",
    "PLATFORM_CROSS_TARGET_RESTORE",
  ];

  for (const template of webTemplates) {
    try {
      const source = readFileSync(join(ROOT, template), "utf8");
      for (const key of privileged) {
        if (new RegExp(`^\\s*${key}\\s*=`, "m").test(source)) {
          failures.push({ name: label, why, file: template, pattern: key });
        }
      }
    } catch {
      // A missing template is covered by the normal packaging/release checks.
    }
  }

  try {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
    const scripts = pkg.scripts ?? {};
    if (String(scripts.dev ?? "").includes(".env.database.local")) {
      failures.push({
        name: label,
        why,
        file: "package.json",
        pattern: "dev -> .env.database.local",
      });
    }
    for (const command of [
      "db:migrate",
      "db:start",
      "db:stop",
      "db:setup",
      "seed",
      "tenant:create",
    ]) {
      if (!String(scripts[command] ?? "").includes(".env.database.local")) {
        failures.push({
          name: label,
          why,
          file: "package.json",
          pattern: `${command} missing .env.database.local`,
        });
      }
    }
  } catch {
    failures.push({
      name: label,
      why,
      file: "package.json",
      pattern: "unreadable package scripts",
    });
  }
}

/* ── 5b. The production Web image carries no backup/restore tooling ─────── */
{
  const label = "backup tooling outside the Web runtime";
  const why =
    "platform backup/restore is an operational job; the Web image must not ship pg_dump/pg_restore, backup volumes or backup runtime variables";
  try {
    const dockerfile = readFileSync(join(ROOT, "Dockerfile"), "utf8");
    for (const [pattern, description] of [
      [/postgresql-client/, "postgresql-client"],
      [/BACKUP_PG_(?:DUMP|RESTORE)_PATH/, "backup binary environment"],
      [/\/var\/lib\/univ\/backups/, "backup volume/path"],
    ]) {
      if (pattern.test(dockerfile)) {
        failures.push({ name: label, why, file: "Dockerfile", pattern: description });
      }
    }
  } catch {
    failures.push({ name: label, why, file: "Dockerfile", pattern: "unreadable Dockerfile" });
  }

  try {
    const backup = readFileSync(join(ROOT, "scripts/platform-backup.mjs"), "utf8");
    if (/--no-privileges/.test(backup)) {
      failures.push({
        name: label,
        why: "backup archives must retain ACLs; restore also reapplies the canonical Web role policy",
        file: "scripts/platform-backup.mjs",
        pattern: "--no-privileges",
      });
    }
    if (!/webRolePrivilegeSql\(pgTarget\.database\)/.test(backup)) {
      failures.push({
        name: label,
        why: "restore must reapply the canonical Web role policy after target-level state is recreated",
        file: "scripts/platform-backup.mjs",
        pattern: "missing webRolePrivilegeSql(pgTarget.database)",
      });
    }
    if (!/workerRolePrivilegeSql\(pgTarget\.database\)/.test(backup)) {
      failures.push({
        name: label,
        why: "restore must reapply the canonical tenant-worker role policy",
        file: "scripts/platform-backup.mjs",
        pattern: "missing workerRolePrivilegeSql(pgTarget.database)",
      });
    }
  } catch {
    failures.push({
      name: label,
      why,
      file: "scripts/platform-backup.mjs",
      pattern: "unreadable backup script",
    });
  }
}

/* ── 6. Database setup preserves the Web/Platform privilege boundary ─────── */
failures.push(...checkDatabasePrivilegeContract(ROOT));

/* ── 8. Liveness and readiness have distinct failure domains ────────────── */
{
  const label = "health probe semantics";
  const why =
    "database outages must fail readiness without turning process liveness into a restart loop";
  try {
    const health = readFileSync(join(ROOT, "src/app/api/healthz/route.ts"), "utf8");
    const ready = readFileSync(join(ROOT, "src/app/api/readyz/route.ts"), "utf8");
    if (/db\(|databaseReady|drizzle-orm|select\s+1/i.test(health)) {
      failures.push({
        name: label,
        why,
        file: "src/app/api/healthz/route.ts",
        pattern: "liveness depends on database",
      });
    }
    if (!/databaseReady\(/.test(ready)) {
      failures.push({
        name: label,
        why,
        file: "src/app/api/readyz/route.ts",
        pattern: "readiness does not inspect database",
      });
    }
  } catch {
    failures.push({ name: label, why, file: "src/app/api", pattern: "unreadable health probes" });
  }
}

if (failures.length > 0) {
  console.error(`\n${failures.length} boundary violation(s):\n`);
  for (const failure of failures) {
    console.error(`  ${failure.file}`);
    console.error(`    ${failure.name}`);
    console.error(`    ${failure.why}`);
    console.error(`    matched ${failure.pattern}\n`);
  }
  process.exit(1);
}

console.log("boundaries: ok");
