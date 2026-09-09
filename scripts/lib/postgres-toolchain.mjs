import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const REQUIRED_BINARIES = ["psql", "initdb", "pg_isready", "postgres", "pg_ctl"];

function completeBinDirectory(directory) {
  if (!directory || !REQUIRED_BINARIES.every((name) => existsSync(join(directory, name)))) {
    return null;
  }
  const version = spawnSync(join(directory, "postgres"), ["--version"], {
    encoding: "utf8",
  });
  if (version.status !== 0 || !/^postgres \(PostgreSQL\) 18\./.test(version.stdout.trim())) {
    return null;
  }
  return Object.fromEntries(REQUIRED_BINARIES.map((name) => [name, join(directory, name)]));
}

/** Resolve a complete PostgreSQL 18 server/client toolchain without guessing. */
export function resolvePostgresToolchain(root) {
  const project = completeBinDirectory(join(root, ".univ", "toolchain", "postgres", "bin"));
  if (project) return project;

  const configured = spawnSync("pg_config", ["--bindir"], { encoding: "utf8" });
  if (configured.status !== 0) return null;
  return completeBinDirectory(configured.stdout.trim());
}

export const postgresToolchainBinaries = REQUIRED_BINARIES;
