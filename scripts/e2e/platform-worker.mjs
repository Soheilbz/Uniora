import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

function laneDatabaseUrl(raw, dbName) {
  if (!raw) throw new Error("E2E_PLATFORM_WORKER requires platform-worker database URLs");
  const url = new URL(raw);
  url.pathname = `/${dbName}`;
  return url.toString();
}

export async function startPlatformWorker({
  lane,
  laneEnv,
  root,
  platformWorkerFile,
  relay,
  workerList,
}) {
  const label = `[g${lane.group}/${lane.project}] `;
  const backupDir = join(root, ".univ", "e2e-backups", laneEnv.E2E_DB_NAME);
  mkdirSync(backupDir, { recursive: true, mode: 0o700 });
  const child = spawn(
    process.execPath,
    ["scripts/platform-worker-env.mjs", "scripts/platform-worker.ts"],
    {
      cwd: root,
      env: {
        ...process.env,
        ...platformWorkerFile,
        ...laneEnv,
        /* This child has already received the lane-specific values above.
           The launcher must not reload the shared developer worker file and
           silently point all lanes back at the local database. */
        UNIV_E2E: "1",
        E2E_EXTERNAL_SERVER: "1",
        NODE_ENV: "development",
        DATABASE_PLATFORM_URL: laneDatabaseUrl(
          platformWorkerFile.DATABASE_PLATFORM_URL ?? process.env.DATABASE_PLATFORM_URL,
          laneEnv.E2E_DB_NAME,
        ),
        DATABASE_URL: laneDatabaseUrl(
          platformWorkerFile.DATABASE_URL ?? process.env.DATABASE_URL,
          laneEnv.E2E_DB_NAME,
        ),
        BACKUP_DIR: backupDir,
        BETTER_AUTH_URL: laneEnv.E2E_BASE_URL,
        PLATFORM_OPERATOR: "e2e-platform-worker",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  relay(`${label}[platform-worker] `, child.stdout, process.stdout);
  relay(`${label}[platform-worker] `, child.stderr, process.stderr);
  workerList.push([`${lane.group}/${lane.project}`, child]);
  await new Promise((resolveWait) => setTimeout(resolveWait, 500));
  if (child.exitCode !== null) {
    throw new Error(`${label}platform worker exited with ${child.exitCode}`);
  }
}
