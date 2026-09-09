import { existsSync, readFileSync, writeFileSync } from "node:fs";

const DATABASE_KEYS = new Set([
  "DATABASE_URL",
  "DATABASE_ADMIN_URL",
  "DATABASE_WORKER_URL",
  "DATABASE_PLATFORM_URL",
]);

/** Keep every local process profile on the same project-local PostgreSQL port. */
export function rewriteLocalDatabasePort({ databaseEnvPath, webEnvPath, root, port }) {
  if (!existsSync(databaseEnvPath)) {
    console.error(
      `PostgreSQL port is unavailable and ${databaseEnvPath} is missing, so the selected port ${port} cannot be persisted.`,
    );
    process.exit(1);
  }

  const rewritePort = (envPath) => {
    if (!existsSync(envPath)) return;
    const lines = readFileSync(envPath, "utf8").split(/\r?\n/);
    const rewritten = lines.map((line) => {
      const equals = line.indexOf("=");
      if (equals <= 0 || !DATABASE_KEYS.has(line.slice(0, equals).trim())) return line;
      const key = line.slice(0, equals).trim();
      try {
        const url = new URL(line.slice(equals + 1).trim());
        url.port = String(port);
        process.env[key] = url.toString();
        return `${key}=${url.toString()}`;
      } catch {
        return line;
      }
    });
    writeFileSync(envPath, rewritten.join("\n"));
  };

  rewritePort(databaseEnvPath);
  rewritePort(webEnvPath);
  for (const profile of [
    ".env.worker.local",
    ".env.platform-worker.local",
    ".env.operations.local",
  ]) {
    rewritePort(`${root}/${profile}`);
  }
}
