#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const failures = [];

/* ── 7. Tenant schema integrity is enforced in both FK and RLS layers ────── */
{
  const label = "tenant schema integrity contract";
  const why =
    "tenant tables need forced RLS and cross-tenant references must carry tenant_id in the foreign key";
  try {
    const journal = JSON.parse(readFileSync(join(ROOT, "drizzle/meta/_journal.json"), "utf8"));
    const latestWithSnapshot = [...journal.entries]
      .reverse()
      .find((entry) =>
        existsSync(
          join(ROOT, "drizzle/meta", `${String(entry.idx).padStart(4, "0")}_snapshot.json`),
        ),
      );
    if (!latestWithSnapshot) throw new Error("no Drizzle schema snapshot is available");
    const snapshotName = `${String(latestWithSnapshot.idx).padStart(4, "0")}_snapshot.json`;
    const snapshot = JSON.parse(readFileSync(join(ROOT, "drizzle/meta", snapshotName), "utf8"));

    // When hand-authored migrations are ahead of Drizzle's generated snapshot,
    // the release manifest is the current schema table-set contract. This keeps
    // the boundary audit on the deployable schema rather than silently auditing
    // only the older generated snapshot.
    const manualBaselinePath = join(ROOT, "drizzle/meta/manual-baseline.json");
    const currentTableNames = existsSync(manualBaselinePath)
      ? new Set(JSON.parse(readFileSync(manualBaselinePath, "utf8")).schemaTables ?? [])
      : new Set(Object.keys(snapshot.tables ?? {}).map((name) => name.replace(/^public\./, "")));
    if (currentTableNames.size === 0) throw new Error("current schema table set is empty");

    // Reconstruct tenant scope and FK contracts from the actual migration DDL.
    // This intentionally supplements the older generated snapshot while the
    // manual-baseline gap is active; check:drizzle-generation prevents creating
    // another migration until a real current snapshot has been generated.
    const migrationFiles = readdirSync(join(ROOT, "drizzle"))
      .filter((name) => /^\d{4}_.+\.sql$/.test(name))
      .sort();
    const ddl = migrationFiles
      .map((name) => readFileSync(join(ROOT, "drizzle", name), "utf8"))
      .join("\n");
    const deltaDdl = migrationFiles
      .filter((name) => Number.parseInt(name.slice(0, 4), 10) > Number(latestWithSnapshot.idx))
      .map((name) => readFileSync(join(ROOT, "drizzle", name), "utf8"))
      .join("\n");
    const tenantTables = new Set();
    const createPattern =
      /CREATE TABLE\s+(?:IF NOT EXISTS\s+)?(?:"public"\.)?"?([a-z0-9_]+)"?\s*\(([\s\S]*?)\);/gi;
    const collectCreateBlocks = (source) => {
      const blocks = [];
      for (const match of source.matchAll(createPattern)) {
        const table = match[1];
        const body = match[2] ?? "";
        if (!table || !currentTableNames.has(table)) continue;
        blocks.push({ table, body });
      }
      return blocks;
    };
    const currentCreateBlocks = collectCreateBlocks(ddl);
    const deltaCreateBlocks = collectCreateBlocks(deltaDdl);
    for (const { table, body } of currentCreateBlocks) {
      if (/\btenant_id\b/i.test(body)) tenantTables.add(table);
    }

    const rlsSource = readFileSync(join(ROOT, "db/sql/after/0001_row_level_security.sql"), "utf8");
    const loopStart = rlsSource.indexOf("FOREACH target");
    const loopEnd = rlsSource.indexOf("END LOOP;", loopStart);
    if (loopStart < 0 || loopEnd < 0) throw new Error("RLS table loop is missing");
    const loop = rlsSource.slice(loopStart, loopEnd);
    const rlsTables = new Set([...loop.matchAll(/'([a-z0-9_]+)'/g)].map((match) => match[1]));
    const rlsExpected = [...tenantTables].filter(
      (table) => !["user", "platform_audit_log"].includes(table),
    );
    for (const table of rlsExpected) {
      if (!rlsTables.has(table)) {
        failures.push({
          name: label,
          why,
          file: "db/sql/after/0001_row_level_security.sql",
          pattern: `missing RLS table ${table}`,
        });
      }
    }
    for (const table of rlsTables) {
      if (!currentTableNames.has(table) || !tenantTables.has(table)) {
        failures.push({
          name: label,
          why: "RLS loop must track only current tenant-scoped tables",
          file: "db/sql/after/0001_row_level_security.sql",
          pattern: `stale/non-tenant RLS table ${table}`,
        });
      }
    }

    const parseColumns = (value) =>
      value
        .split(",")
        .map((column) => column.trim().replaceAll('"', "").toLowerCase())
        .filter(Boolean);
    const inspectForeignKeys = (sourceTable, source) => {
      const fkPattern =
        /FOREIGN KEY\s*\(([^)]+)\)\s*REFERENCES\s+(?:"public"\.)?"?([a-z0-9_]+)"?\s*\(([^)]+)\)/gi;
      for (const match of source.matchAll(fkPattern)) {
        const targetTable = match[2]?.toLowerCase();
        if (!targetTable || targetTable === "tenants") continue;
        if (!tenantTables.has(sourceTable) || !tenantTables.has(targetTable)) continue;
        if (!parseColumns(match[1] ?? "").includes("tenant_id")) {
          failures.push({
            name: label,
            why,
            file: "drizzle/*.sql",
            pattern: `${sourceTable} -> ${targetTable} without tenant_id in the foreign key`,
          });
        }
      }
    };
    // Generated-snapshot FKs cover the schema through latestWithSnapshot.
    // Audit only post-snapshot hand-authored FK additions from SQL so historical
    // constraints that were already replaced before the snapshot do not create
    // false positives.
    const snapshotTables = snapshot.tables ?? {};
    const snapshotTenantTables = new Set(
      Object.entries(snapshotTables)
        .filter(([, table]) => Object.hasOwn(table.columns ?? {}, "tenant_id"))
        .map(([name]) => name.replace(/^public\./, "")),
    );
    for (const [fullName, table] of Object.entries(snapshotTables)) {
      const sourceTable = fullName.replace(/^public\./, "");
      if (!snapshotTenantTables.has(sourceTable)) continue;
      for (const fk of Object.values(table.foreignKeys ?? {})) {
        const targetTable = fk.tableTo;
        if (targetTable === "tenants" || !snapshotTenantTables.has(targetTable)) continue;
        if (!(fk.columnsFrom ?? []).includes("tenant_id")) {
          failures.push({
            name: label,
            why,
            file: `drizzle/meta/${snapshotName}`,
            pattern: `${sourceTable}.${fk.name} -> ${targetTable} without tenant_id`,
          });
        }
      }
    }

    for (const { table, body } of deltaCreateBlocks) inspectForeignKeys(table, body);
    const alterPattern =
      /ALTER TABLE\s+(?:ONLY\s+)?(?:"public"\.)?"?([a-z0-9_]+)"?\s+ADD CONSTRAINT[^;]*?FOREIGN KEY\s*\(([^)]+)\)\s*REFERENCES\s+(?:"public"\.)?"?([a-z0-9_]+)"?\s*\(([^)]+)\)[^;]*;/gi;
    for (const match of deltaDdl.matchAll(alterPattern)) {
      const sourceTable = match[1]?.toLowerCase();
      const targetTable = match[3]?.toLowerCase();
      if (!sourceTable || !targetTable || targetTable === "tenants") continue;
      if (!tenantTables.has(sourceTable) || !tenantTables.has(targetTable)) continue;
      if (!parseColumns(match[2] ?? "").includes("tenant_id")) {
        failures.push({
          name: label,
          why,
          file: "drizzle/*.sql",
          pattern: `${sourceTable} -> ${targetTable} without tenant_id in the foreign key`,
        });
      }
    }

    for (const indirect of ["role_capabilities", "login_attempts"]) {
      const block = new RegExp(
        `ALTER TABLE ${indirect} ENABLE ROW LEVEL SECURITY;[\\s\\S]*?ALTER TABLE ${indirect} FORCE ROW LEVEL SECURITY;`,
      );
      if (!block.test(rlsSource)) {
        failures.push({
          name: label,
          why,
          file: "db/sql/after/0001_row_level_security.sql",
          pattern: `missing forced indirect RLS ${indirect}`,
        });
      }
    }
  } catch (error) {
    failures.push({
      name: label,
      why,
      file: "drizzle/meta + drizzle/*.sql",
      pattern: `schema audit failed: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
}

if (failures.length) {
  console.error(
    `tenant schema integrity failed (${failures.length} issue${failures.length === 1 ? "" : "s"}):`,
  );
  for (const failure of failures) {
    console.error(`- ${failure.file}: ${failure.pattern} — ${failure.why}`);
  }
  process.exit(1);
}
console.log("tenant schema integrity contract ok");
