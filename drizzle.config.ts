import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "drizzle-kit";

/*
 * `.env.local`, loaded here rather than by the invoking command.
 *
 * `pnpm db:generate` and `pnpm db:migrate` run drizzle-kit as a bare CLI, with
 * no `--env-file` plumbing — unlike every script that goes through `node`.
 * Reading the file at config-evaluation time means both commands see the same
 * DATABASE_URL the application does, and an environment variable already set
 * by the caller still wins.
 */
const envPath = fileURLToPath(new URL("./.env.local", import.meta.url));
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq);
    if (!(key in process.env)) process.env[key] = trimmed.slice(eq + 1);
  }
}

/**
 * Schema management for the Web application.
 *
 * Migrations are generated from `src/db/schema.ts`. Row-level security policies
 * live in explicit SQL migrations because PostgreSQL RLS is not represented by
 * Drizzle table definitions; release checks therefore validate both the schema
 * and the policy layer.
 */
export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL ?? "" },
  // Loud rather than convenient: this database holds national identity numbers
  // and bank accounts, and a silently-applied destructive change is not a thing
  // this project should be able to do by accident.
  strict: true,
  verbose: true,
});
