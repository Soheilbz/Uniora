import { readFileSync } from "node:fs";
import {
  platformWorkerEnvironmentFailures,
  tenantWorkerEnvironmentFailures,
} from "./lib/runtime-environment-policy.ts";

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const failures = [];
const requireText = (file, needle, label = needle) => {
  if (!read(file).includes(needle)) failures.push(`${file}: missing ${label}`);
};
const forbidText = (file, needle, label = needle) => {
  if (read(file).includes(needle)) failures.push(`${file}: forbidden ${label}`);
};

requireText(
  "scripts/job-worker.mjs",
  "assertTenantWorkerEnvironment(process.env)",
  "tenant worker self-validates runtime environment",
);
requireText(
  "scripts/platform-worker.ts",
  "assertPlatformWorkerEnvironment(process.env)",
  "Platform worker self-validates runtime environment",
);
requireText(
  "scripts/worker-production-check.mjs",
  "tenantWorkerEnvironmentFailures",
  "tenant worker preflight shares runtime policy",
);
requireText(
  "scripts/platform-worker-production-check.mjs",
  "platformWorkerEnvironmentFailures",
  "Platform worker preflight shares runtime policy",
);

requireText(
  ".github/workflows/ci.yml",
  "DATABASE_PLATFORM_URL: postgresql://univ_platform_worker:",
  "canonical platform-worker CI role",
);
forbidText(
  ".github/workflows/ci.yml",
  "DATABASE_ADMIN_URL: postgresql://univ_owner:ci-owner-secret",
  "owner credential in platform-worker CI preflight",
);
requireText(
  ".github/workflows/ci.yml",
  "pnpm audit --prod --audit-level=high",
  "high-severity production dependency gate",
);
requireText(
  "deploy/compose.production.yml",
  'user: "' + "$" + "{UNIV_RUNTIME_UID:-1000}:" + "$" + '{UNIV_RUNTIME_GID:-1000}"',
  "explicit non-root runtime uid/gid",
);
requireText(
  "deploy/compose.production.yml",
  "target: /var/lib/univ-web/exports\n        read_only: true\n\n  job-worker:",
  "Web export bind mount is read-only while worker remains the writer",
);
requireText("deploy/prepare-host.sh", "UNIV_RUNTIME_GID=$RUNTIME_GID", "persisted runtime gid");
requireText(
  "deploy/host-preflight.sh",
  'gid="$(stat -c \'%g\' "$dir"',
  "runtime gid ownership verification",
);
requireText(
  "src/lib/runtime-config.ts",
  'database.username !== "univ_app_web"',
  "runtime canonical Web database role assertion",
);
requireText(
  "src/lib/runtime-config.ts",
  '"PUBLIC_FORM_RATE_SALT",',
  "runtime public-form salt requirement",
);
requireText(
  "src/app/workshops/public/[slug]/actions.ts",
  "PUBLIC_FORM_RATE_SALT is required for public forms",
  "dedicated public form salt",
);
forbidText(
  "src/app/workshops/public/[slug]/actions.ts",
  "|| process.env.BETTER_AUTH_SECRET",
  "authentication-secret fallback for public rate limiting",
);
requireText(
  "src/lib/storage/s3-compatible.ts",
  'segment === "." || segment === ".."',
  "object-key dot-segment rejection",
);
requireText(
  "src/lib/storage/object-storage.ts",
  'normalized === "." || normalized === ".."',
  "object-key component dot-segment rejection",
);
requireText(
  "src/app/(app)/calendar/export.ics/route.ts",
  "applicationOrigin()",
  "canonical ICS origin",
);
requireText(
  "src/app/calendar-feed/[token]/route.ts",
  "applicationOrigin()",
  "canonical subscription feed origin",
);
requireText(
  "src/app/(app)/calendar/subscriptions/page.tsx",
  "applicationOrigin()",
  "canonical calendar-subscription creation origin",
);
forbidText(
  "src/app/(app)/calendar/subscriptions/page.tsx",
  "x-forwarded-proto",
  "proxy-derived calendar-subscription origin",
);
requireText(
  "src/lib/platform-viewer.ts",
  "PLATFORM_SESSION_HOURS must be an integer between 1 and",
  "fail-closed platform session duration",
);
requireText(
  "src/lib/jobs/export-route.ts",
  "applicationOrigin()",
  "canonical export redirect origin",
);
requireText(
  "db/sql/after/0003_public_surfaces.sql",
  "public.rate_limit.count+1",
  "atomic public-form rate limiter",
);
requireText(
  "db/sql/after/0003_public_surfaces.sql",
  "s.rate_limit_per_minute",
  "service-account configured rate limit",
);
requireText(
  "db/sql/after/0003_public_surfaces.sql",
  "CREATE OR REPLACE FUNCTION app.resolve_calendar_subscription",
  "canonical calendar subscription resolver",
);
requireText(
  "db/sql/after/0003_public_surfaces.sql",
  "t.provisioning_status='active'",
  "calendar token tenant lifecycle check",
);
requireText(
  "db/sql/after/0003_public_surfaces.sql",
  "u.suspended_at IS NULL",
  "calendar token user suspension check",
);
requireText(
  "db/sql/after/0003_public_surfaces.sql",
  "u.employment_end IS NULL OR u.employment_end>=current_date",
  "calendar token employment lifecycle check",
);

const tenantWorkerGood = {
  NODE_ENV: "production",
  DATABASE_WORKER_URL:
    "postgresql://univ_job_worker:worker-secret@db.example:5432/univ?sslmode=verify-full",
  DATABASE_URL: "postgresql://univ_app_web:web-secret@db.example:5432/univ?sslmode=verify-full",
  EXPORT_JOB_DIR: "/var/lib/univ-web/exports",
  PLATFORM_OPERATOR: "tenant-job-worker",
  INTEGRATION_ENCRYPTION_KEY: "a".repeat(64),
  OBJECT_STORAGE_ENDPOINT: "https://s3-internal.example",
  OBJECT_STORAGE_PUBLIC_ENDPOINT: "https://s3.example",
  OBJECT_STORAGE_BUCKET: "univ-objects",
  OBJECT_STORAGE_ACCESS_KEY_ID: "univ-worker",
  OBJECT_STORAGE_SECRET_ACCESS_KEY: "s".repeat(40),
  OBJECT_STORAGE_PATH_STYLE: "true",
  ANTIVIRUS_HTTP_ENDPOINT: "https://scanner.example/scan",
  JOB_LEASE_SECONDS: "180",
  JOB_HEARTBEAT_MS: "30000",
  JOB_POLL_MS: "2000",
};
const tenantWorkerGoodFailures = tenantWorkerEnvironmentFailures(tenantWorkerGood);
if (tenantWorkerGoodFailures.length)
  failures.push(`tenant worker policy rejects valid env: ${tenantWorkerGoodFailures.join("; ")}`);
const wrongWorkerRole = tenantWorkerEnvironmentFailures({
  ...tenantWorkerGood,
  DATABASE_WORKER_URL: tenantWorkerGood.DATABASE_WORKER_URL.replace("univ_job_worker", "univ"),
});
if (!wrongWorkerRole.some((value) => value.includes("canonical univ_job_worker")))
  failures.push("tenant worker policy does not reject a non-canonical DB role");
const leakedAdmin = tenantWorkerEnvironmentFailures({
  ...tenantWorkerGood,
  DATABASE_ADMIN_URL: "postgresql://univ:secret@db.example/univ",
});
if (!leakedAdmin.some((value) => value.includes("DATABASE_ADMIN_URL must not be present")))
  failures.push("tenant worker policy does not reject owner credentials");
const badHeartbeat = tenantWorkerEnvironmentFailures({
  ...tenantWorkerGood,
  JOB_HEARTBEAT_MS: "120000",
  JOB_LEASE_SECONDS: "180",
});
if (!badHeartbeat.some((value) => value.includes("half of JOB_LEASE_SECONDS")))
  failures.push("tenant worker policy does not enforce heartbeat/lease fencing cadence");

const platformWorkerGood = {
  NODE_ENV: "production",
  DATABASE_PLATFORM_URL:
    "postgresql://univ_platform_worker:platform-secret@db.example:5432/univ?sslmode=verify-full",
  DATABASE_URL: tenantWorkerGood.DATABASE_URL,
  BETTER_AUTH_SECRET: "b".repeat(64),
  BETTER_AUTH_URL: "https://univ.example",
  PLATFORM_OPERATOR: "platform-console",
  PLATFORM_OPERATION_ENCRYPTION_KEY: "c".repeat(64),
  BACKUP_ACTIVE_KEY_ID: "k1",
  BACKUP_ENCRYPTION_KEYS: JSON.stringify({ k1: "d".repeat(64) }),
  BACKUP_DIR: "/var/lib/univ-web/backups",
};
const platformWorkerGoodFailures = platformWorkerEnvironmentFailures(platformWorkerGood);
if (platformWorkerGoodFailures.length)
  failures.push(
    `Platform worker policy rejects valid env: ${platformWorkerGoodFailures.join("; ")}`,
  );
const badBackupKeyring = platformWorkerEnvironmentFailures({
  ...platformWorkerGood,
  BACKUP_ENCRYPTION_KEYS: JSON.stringify({ k1: "short" }),
});
if (!badBackupKeyring.some((value) => value.includes("64-hex keys")))
  failures.push("Platform worker policy does not reject malformed backup keys");

if (failures.length) {
  for (const failure of failures) console.error(`deployment contract error: ${failure}`);
  process.exit(1);
}
console.log("deployment contracts: ok");
