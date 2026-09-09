import { describe, expect, it } from "vitest";
import {
  assertCanonicalLocalDatabaseTargets,
  type LocalDatabaseTarget,
} from "./local-database-target";

const values = (overrides: Partial<Record<string, string>> = {}): LocalDatabaseTarget[] => [
  {
    name: ".env.database.local:DATABASE_ADMIN_URL",
    role: "univ_owner",
    url:
      overrides[".env.database.local:DATABASE_ADMIN_URL"] ??
      "postgresql://univ_owner:owner@127.0.0.1:55432/univ?sslmode=disable",
  },
  {
    name: ".env.database.local:DATABASE_URL",
    role: "univ_app_web",
    url:
      overrides[".env.database.local:DATABASE_URL"] ??
      "postgresql://univ_app_web:web@127.0.0.1:55432/univ?sslmode=disable",
  },
  {
    name: ".env.local:DATABASE_URL",
    role: "univ_app_web",
    url:
      overrides[".env.local:DATABASE_URL"] ??
      "postgresql://univ_app_web:web@127.0.0.1:55432/univ?sslmode=disable",
  },
  {
    name: ".env.database.local:DATABASE_WORKER_URL",
    role: "univ_job_worker",
    url:
      overrides[".env.database.local:DATABASE_WORKER_URL"] ??
      "postgresql://univ_job_worker:worker@127.0.0.1:55432/univ?sslmode=disable",
  },
  {
    name: ".env.database.local:DATABASE_PLATFORM_URL",
    role: "univ_platform_worker",
    url:
      overrides[".env.database.local:DATABASE_PLATFORM_URL"] ??
      "postgresql://univ_platform_worker:platform@127.0.0.1:55432/univ?sslmode=disable",
  },
];

describe("assertCanonicalLocalDatabaseTargets", () => {
  it("accepts distinct runtime roles on one canonical database", () => {
    expect(assertCanonicalLocalDatabaseTargets(values())).toBe(
      "127.0.0.1:55432/univ (sslmode=disable)",
    );
  });

  it("refuses a URL that points at another database target", () => {
    expect(() =>
      assertCanonicalLocalDatabaseTargets(
        values().map((target) =>
          target.name === ".env.local:DATABASE_URL"
            ? {
                ...target,
                url: "postgresql://univ_app_web:web@127.0.0.1:5433/univ?sslmode=disable",
              }
            : target,
        ),
      ),
    ).toThrow(/split-brain refused/);
  });

  it("refuses a URL carrying the wrong runtime role", () => {
    expect(() =>
      assertCanonicalLocalDatabaseTargets(
        values().map((target) =>
          target.name === ".env.database.local:DATABASE_PLATFORM_URL"
            ? {
                ...target,
                url: "postgresql://univ_job_worker:platform@127.0.0.1:55432/univ?sslmode=disable",
              }
            : target,
        ),
      ),
    ).toThrow(/univ_platform_worker role/);
  });
});
