import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import {
  PLATFORM_EXECUTE_FUNCTIONS,
  PLATFORM_MUTABLE_TABLES,
} from "../lib/platform-role-policy.mjs";
import {
  WEB_APPEND_ONLY_TABLES,
  WEB_EXECUTE_FUNCTIONS,
  WEB_MUTABLE_TABLES,
  WEB_READ_ONLY_TABLES,
} from "../lib/web-role-policy.mjs";
import { WORKER_EXECUTE_FUNCTIONS, WORKER_TABLE_PRIVILEGES } from "../lib/worker-role-policy.mjs";

export function checkDatabasePrivilegeContract(root) {
  const failures = [];
  const label = "database setup privilege contract";
  const why =
    "db:setup and restore must share one fail-closed Web privilege allow-list; new tables stay inaccessible until reviewed";
  try {
    const dbSource = readFileSync(join(root, "scripts/db.mjs"), "utf8");
    const policySource = readFileSync(join(root, "scripts/lib/web-role-policy.mjs"), "utf8");
    const workerPolicySource = readFileSync(
      join(root, "scripts/lib/worker-role-policy.mjs"),
      "utf8",
    );
    for (const [source, file, pattern, description] of [
      [dbSource, "scripts/db.mjs", /function\s+setup\s*\(/, "function setup"],
      [
        dbSource,
        "scripts/db.mjs",
        /webRolePrivilegeSql\(DATABASE\)/,
        "setup uses canonical policy",
      ],
      [
        dbSource,
        "scripts/db.mjs",
        /workerRolePrivilegeSql\(DATABASE\)/,
        "setup uses canonical tenant-worker policy",
      ],
      [
        workerPolicySource,
        "scripts/lib/worker-role-policy.mjs",
        /REVOKE\s+ALL\s+PRIVILEGES\s+ON\s+ALL\s+TABLES\s+IN\s+SCHEMA\s+public/i,
        "tenant-worker grants rebuild from zero",
      ],
      [
        dbSource,
        "scripts/db.mjs",
        /applySql\("after"\);[\s\S]*webRolePrivilegeSql\(DATABASE\)/,
        "migrate reapplies canonical policy after schema changes",
      ],
      [
        policySource,
        "scripts/lib/web-role-policy.mjs",
        /REVOKE\s+ALL\s+PRIVILEGES\s+ON\s+platform_audit_log/i,
        "platform audit revoke",
      ],
      [
        policySource,
        "scripts/lib/web-role-policy.mjs",
        /REVOKE\s+EXECUTE\s+ON\s+ALL\s+FUNCTIONS\s+IN\s+SCHEMA\s+app\s+FROM\s+PUBLIC/i,
        "revoke ambient app function execute",
      ],
      [
        policySource,
        "scripts/lib/web-role-policy.mjs",
        /GRANT\s+SELECT\s+ON\s+TABLE\s+tenants/i,
        "tenant read-only grant",
      ],
      [
        policySource,
        "scripts/lib/web-role-policy.mjs",
        /GRANT\s+SELECT,\s*INSERT\s+ON\s+TABLE\s+\$\{appendOnly\}/i,
        "append-only table grant",
      ],
      [
        policySource,
        "scripts/lib/web-role-policy.mjs",
        /GRANT\s+SELECT\s+ON\s+TABLE\s+\$\{readOnly\}/i,
        "worker-owned read-only table grant",
      ],
    ]) {
      if (!pattern.test(source)) failures.push({ name: label, why, file, pattern: description });
    }
    if (/APP_DB_BACKUP_PASSWORD|ensureBackupRole|univ_app_backup/.test(dbSource)) {
      failures.push({
        name: label,
        why,
        file: "scripts/db.mjs",
        pattern: "retired in-app backup role",
      });
    }

    const e2eProvision = readFileSync(join(root, "scripts/e2e/provision.mjs"), "utf8");
    if (!/webRolePrivilegeSql\(DB_NAME\)/.test(e2eProvision)) {
      failures.push({
        name: label,
        why: "E2E must provision the exact production Web privilege policy",
        file: "scripts/e2e/provision.mjs",
        pattern: "missing webRolePrivilegeSql(DB_NAME)",
      });
    }
    if (!/workerRolePrivilegeSql\(DB_NAME\)/.test(e2eProvision)) {
      failures.push({
        name: label,
        why: "E2E must provision the exact production tenant-worker privilege policy",
        file: "scripts/e2e/provision.mjs",
        pattern: "missing workerRolePrivilegeSql(DB_NAME)",
      });
    }
    if (/GRANT\s+EXECUTE\s+ON\s+ALL\s+FUNCTIONS/i.test(e2eProvision)) {
      failures.push({
        name: label,
        why: "E2E must not hide production function-grant gaps behind a permissive grant",
        file: "scripts/e2e/provision.mjs",
        pattern: "GRANT EXECUTE ON ALL FUNCTIONS",
      });
    }

    const allowedFunctionNames = new Set(
      WEB_EXECUTE_FUNCTIONS.map((signature) => signature.slice(4, signature.indexOf("("))),
    );
    const definedFunctionNames = new Set();
    for (const sqlDir of [
      join(root, "db/sql/before"),
      join(root, "db/sql/after"),
      join(root, "drizzle"),
    ]) {
      if (!existsSync(sqlDir)) continue;
      for (const entry of readdirSync(sqlDir)) {
        if (!entry.endsWith(".sql")) continue;
        const source = readFileSync(join(sqlDir, entry), "utf8");
        for (const match of source.matchAll(
          /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+app\.([a-z_]+)\s*\(/gi,
        )) {
          definedFunctionNames.add(match[1]);
        }
      }
    }
    for (const signature of WEB_EXECUTE_FUNCTIONS) {
      const name = signature.slice(4, signature.indexOf("("));
      if (!definedFunctionNames.has(name)) {
        failures.push({
          name: label,
          why: "the Web function allow-list must name a real app function",
          file: "scripts/lib/web-role-policy.mjs",
          pattern: `undefined function ${signature}`,
        });
      }
    }
    for (const file of walk(join(root, "src"))) {
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(/\bapp\.([a-z_]+)\s*\(/g)) {
        if (!allowedFunctionNames.has(match[1])) {
          failures.push({
            name: label,
            why: "application SQL may only call app functions in the explicit Web execute allow-list",
            file: relative(root, file).split(sep).join("/"),
            pattern: `app.${match[1]}() is not allowed`,
          });
        }
      }
    }

    const schemaSources = [
      readFileSync(join(root, "src/db/schema.ts"), "utf8"),
      ...[...walk(join(root, "src/db/schema"))].map((file) => readFileSync(file, "utf8")),
    ];
    const schemaTables = new Set(
      schemaSources.flatMap((schema) =>
        [...schema.matchAll(/pgTable\(\s*["']([a-z0-9_]+)["']/g)].map((match) => match[1]),
      ),
    );
    const classes = [
      ["mutable", new Set(WEB_MUTABLE_TABLES)],
      ["append-only", new Set(WEB_APPEND_ONLY_TABLES)],
      ["read-only", new Set(WEB_READ_ONLY_TABLES)],
    ];
    for (let left = 0; left < classes.length; left += 1) {
      for (let right = left + 1; right < classes.length; right += 1) {
        const overlap = [...classes[left][1]].filter((table) => classes[right][1].has(table));
        if (overlap.length > 0) {
          failures.push({
            name: label,
            why: "a table must have exactly one Web privilege class",
            file: "scripts/lib/web-role-policy.mjs",
            pattern: `${String(classes[left][0])} / ${String(classes[right][0])} overlap: ${overlap.join(",")}`,
          });
        }
      }
    }

    const classified = new Set(classes.flatMap(([, tables]) => [...tables]));
    const explicitSpecialCases = new Set(["tenants", "platform_audit_log"]);
    const missingClassification = [...schemaTables].filter(
      (table) => !classified.has(table) && !explicitSpecialCases.has(table),
    );
    const unknownClassification = [...classified].filter((table) => !schemaTables.has(table));
    if (missingClassification.length > 0) {
      failures.push({
        name: label,
        why,
        file: "scripts/lib/web-role-policy.mjs",
        pattern: `unclassified Web tables: ${missingClassification.join(",")}`,
      });
    }
    if (unknownClassification.length > 0) {
      failures.push({
        name: label,
        why,
        file: "scripts/lib/web-role-policy.mjs",
        pattern: `unknown classified tables: ${unknownClassification.join(",")}`,
      });
    }
    for (const required of ["audit_log", "jobs", "outbox_events"]) {
      if (!WEB_APPEND_ONLY_TABLES.includes(required)) {
        failures.push({
          name: label,
          why: "audit and enqueue ledgers must remain append-only from Web",
          file: "scripts/lib/web-role-policy.mjs",
          pattern: `${required} is not append-only`,
        });
      }
    }

    const expectedWorker = {
      jobs: ["SELECT", "UPDATE"],
      job_attempts: ["SELECT", "INSERT", "UPDATE", "DELETE"],
      platform_audit_log: ["INSERT"],
    };
    if (
      !WORKER_EXECUTE_FUNCTIONS.includes(
        "app.upsert_tenant_worker_health(text,text,text,timestamptz)",
      )
    ) {
      failures.push({
        name: label,
        why: "tenant worker health writes must use the constrained definer function",
        file: "scripts/lib/worker-role-policy.mjs",
        pattern: "tenant worker health execute grant missing",
      });
    }
    if (/worker_runtime_health\s*:\s*Object\.freeze/.test(workerPolicySource)) {
      failures.push({
        name: label,
        why: "tenant worker must not have direct DML authority on shared worker health",
        file: "scripts/lib/worker-role-policy.mjs",
        pattern: "direct worker_runtime_health table grant",
      });
    }
    if (
      !PLATFORM_EXECUTE_FUNCTIONS.includes(
        "app.upsert_platform_worker_health(text,text,text,timestamptz)",
      )
    ) {
      failures.push({
        name: label,
        why: "platform worker health writes must use the constrained definer function",
        file: "scripts/lib/platform-role-policy.mjs",
        pattern: "platform worker health execute grant missing",
      });
    }
    if (PLATFORM_MUTABLE_TABLES.includes("worker_runtime_health")) {
      failures.push({
        name: label,
        why: "platform worker must not have direct DML authority on shared worker health",
        file: "scripts/lib/platform-role-policy.mjs",
        pattern: "direct worker_runtime_health table grant",
      });
    }

    if (JSON.stringify(WORKER_TABLE_PRIVILEGES) !== JSON.stringify(expectedWorker)) {
      failures.push({
        name: label,
        why: "tenant-worker BYPASSRLS authority must remain constrained to the reviewed queue allow-list",
        file: "scripts/lib/worker-role-policy.mjs",
        pattern: "tenant-worker privilege allow-list drift",
      });
    }
  } catch {
    failures.push({
      name: label,
      why,
      file: "scripts/lib/web-role-policy.mjs",
      pattern: "unreadable database privilege policy",
    });
  }
  return failures;
}

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
