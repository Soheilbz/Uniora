import { describe, expect, it } from "vitest";
import { databaseReady } from "./readiness.ts";

describe.skipIf(!process.env.DATABASE_URL)("database readiness", () => {
  it("accepts the migrated database with the restricted Web role", async () => {
    await expect(databaseReady()).resolves.toBe(true);
  });
});
