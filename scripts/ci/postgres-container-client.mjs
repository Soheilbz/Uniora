#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { basename, relative, resolve } from "node:path";

const tool = basename(process.argv[1]);
if (tool !== "pg_dump" && tool !== "pg_restore") {
  console.error(`unsupported PostgreSQL client wrapper: ${tool}`);
  process.exit(2);
}

const image = process.env.PG_DOCKER_IMAGE?.trim();
if (!image) {
  console.error("PG_DOCKER_IMAGE is required for the pinned PostgreSQL client wrapper");
  process.exit(2);
}

const workspace = resolve(process.env.GITHUB_WORKSPACE?.trim() || process.cwd());
const containerWorkspace = "/univ-workspace";
const args = process.argv.slice(2).map((value) => {
  if (!value.startsWith("/")) return value;
  const absolute = resolve(value);
  const pathFromWorkspace = relative(workspace, absolute);
  if (
    pathFromWorkspace === "" ||
    (!pathFromWorkspace.startsWith("..") && !pathFromWorkspace.startsWith("../"))
  ) {
    return `${containerWorkspace}/${pathFromWorkspace}`;
  }
  return value;
});

const dockerArgs = [
  "run",
  "--rm",
  "--network",
  "host",
  "--user",
  `${process.getuid?.() ?? 1000}:${process.getgid?.() ?? 1000}`,
  "--volume",
  `${workspace}:${containerWorkspace}`,
  "--entrypoint",
  tool,
];
for (const name of [
  "PGHOST",
  "PGPORT",
  "PGUSER",
  "PGPASSWORD",
  "PGDATABASE",
  "PGCLIENTENCODING",
  "PGSSLMODE",
  "PGSSLROOTCERT",
  "PGSSLCERT",
  "PGSSLKEY",
  "PGSSLCRL",
  "PGCHANNELBINDING",
  "PGTARGETSESSIONATTRS",
  "PGCONNECT_TIMEOUT",
  "PGAPPNAME",
  "PGOPTIONS",
]) {
  if (process.env[name] !== undefined) dockerArgs.push("--env", `${name}=${process.env[name]}`);
}
dockerArgs.push(image, ...args);

const result = spawnSync("docker", dockerArgs, { stdio: "inherit" });
if (result.error) throw result.error;
process.exit(result.status ?? 1);
