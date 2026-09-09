import { afterEach, describe, expect, it } from "vitest";
import { assertRuntimeConfig } from "./runtime-config.ts";

const KEYS = [
  "NODE_ENV",
  "DATABASE_URL",
  "BACKUP_ENCRYPTION_KEY",
  "BACKUP_DIR",
  "BACKUP_OFFSITE_DIR",
  "BETTER_AUTH_SECRET",
  "MFA_ENCRYPTION_KEY",
  "BETTER_AUTH_URL",
  "TRUSTED_ORIGINS",
  "DATABASE_ADMIN_URL",
  "APP_DB_PASSWORD",
  "PLATFORM_OPERATOR",
  "PLATFORM_RESTORE_ALLOWED",
  "PLATFORM_CROSS_TARGET_RESTORE",
  "SEED_ADMIN_PASSWORD",
  "TENANT_ADMIN_PASSWORD",
  "E2E_ADMIN_URL",
  "UNIV_E2E",
  "E2E_EXTERNAL_SERVER",
  "EXPORT_JOB_DIR",
  "PLATFORM_OPERATION_ENCRYPTION_KEY",
  "INTEGRATION_ENCRYPTION_KEY",
  "PUBLIC_FORM_RATE_SALT",
  "PLATFORM_SESSION_HOURS",
  "OBJECT_STORAGE_ENDPOINT",
  "OBJECT_STORAGE_PUBLIC_ENDPOINT",
  "OBJECT_STORAGE_BROWSER_ORIGIN",
  "OBJECT_STORAGE_BUCKET",
  "OBJECT_STORAGE_ACCESS_KEY_ID",
  "OBJECT_STORAGE_SECRET_ACCESS_KEY",
  "TRUSTED_PROXY_HOPS",
] as const;

const saved = new Map<string, string | undefined>();

function setProductionEnvironment(overrides: Record<string, string> = {}) {
  for (const key of KEYS) {
    if (!saved.has(key)) saved.set(key, process.env[key]);
    delete process.env[key];
  }
  Object.assign(process.env, {
    NODE_ENV: "production",
    DATABASE_URL:
      "postgresql://univ_app_web:secret@db.example.internal:5432/univ?sslmode=verify-full",
    BETTER_AUTH_SECRET: "a-production-secret-with-more-than-thirty-two-characters",
    MFA_ENCRYPTION_KEY: "a-distinct-production-mfa-key-with-more-than-thirty-two-characters",
    BETTER_AUTH_URL: "https://univ.example.com",
    TRUSTED_ORIGINS: "https://univ.example.com",
    EXPORT_JOB_DIR: "/srv/univ-web/exports",
    PLATFORM_OPERATION_ENCRYPTION_KEY:
      "a-distinct-platform-operation-key-with-more-than-thirty-two-characters",
    INTEGRATION_ENCRYPTION_KEY:
      "a-distinct-production-integration-key-with-more-than-thirty-two-characters",
    PUBLIC_FORM_RATE_SALT:
      "a-distinct-production-public-form-salt-with-more-than-thirty-two-characters",
    PLATFORM_SESSION_HOURS: "4",
    OBJECT_STORAGE_ENDPOINT: "https://storage.example.com",
    OBJECT_STORAGE_PUBLIC_ENDPOINT: "https://storage.example.com",
    OBJECT_STORAGE_BROWSER_ORIGIN: "https://storage.example.com",
    OBJECT_STORAGE_BUCKET: "univ-test-bucket",
    OBJECT_STORAGE_ACCESS_KEY_ID: "test-access-key",
    OBJECT_STORAGE_SECRET_ACCESS_KEY: "test-secret-key",
    TRUSTED_PROXY_HOPS: "1",
    ...overrides,
  });
}

afterEach(() => {
  for (const key of KEYS) {
    const value = saved.get(key);
    if (value === undefined) delete process.env[key];
    else (process.env as Record<string, string | undefined>)[key] = value;
  }
  saved.clear();
});

describe("production runtime configuration", () => {
  it("accepts an explicitly secure production environment", () => {
    setProductionEnvironment();
    expect(() => assertRuntimeConfig()).not.toThrow();
  });

  it("does not require any privileged backup credential in the web process", () => {
    setProductionEnvironment();
    expect(() => assertRuntimeConfig()).not.toThrow();
  });

  it("rejects a privileged backup credential in the web process", () => {
    setProductionEnvironment({
      BACKUP_ENCRYPTION_KEY: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    });
    expect(() => assertRuntimeConfig()).toThrow("BACKUP_ENCRYPTION_KEY must not be present");
  });

  it("requires a strong MFA encryption key distinct from the auth secret", () => {
    setProductionEnvironment({ MFA_ENCRYPTION_KEY: "short" });
    expect(() => assertRuntimeConfig()).toThrow("MFA_ENCRYPTION_KEY");

    setProductionEnvironment({
      MFA_ENCRYPTION_KEY: "a-production-secret-with-more-than-thirty-two-characters",
    });
    expect(() => assertRuntimeConfig()).toThrow("must be distinct");
  });

  it("requires a distinct platform operation encryption key", () => {
    setProductionEnvironment({ PLATFORM_OPERATION_ENCRYPTION_KEY: "short" });
    expect(() => assertRuntimeConfig()).toThrow("PLATFORM_OPERATION_ENCRYPTION_KEY");

    setProductionEnvironment({
      PLATFORM_OPERATION_ENCRYPTION_KEY: "a-production-secret-with-more-than-thirty-two-characters",
    });
    expect(() => assertRuntimeConfig()).toThrow("must be distinct");
  });

  it("bounds the effective platform session lifetime", () => {
    setProductionEnvironment({ PLATFORM_SESSION_HOURS: "12" });
    expect(() => assertRuntimeConfig()).toThrow("PLATFORM_SESSION_HOURS");
  });

  it("rejects a database connection without certificate verification", () => {
    setProductionEnvironment({
      DATABASE_URL: "postgresql://app:secret@db.example.internal:5432/univ?sslmode=require",
    });
    expect(() => assertRuntimeConfig()).toThrow("sslmode=verify-full");
  });

  it("rejects an owning-role credential in the web process", () => {
    setProductionEnvironment({
      DATABASE_ADMIN_URL: "postgresql://owner:secret@db.example.internal:5432/univ",
    });
    expect(() => assertRuntimeConfig()).toThrow("DATABASE_ADMIN_URL must not be present");
  });

  it("rejects provisioning and operator-only secrets in the web process", () => {
    setProductionEnvironment({ APP_DB_PASSWORD: "setup-only-secret" });
    expect(() => assertRuntimeConfig()).toThrow("APP_DB_PASSWORD must not be present");

    setProductionEnvironment({ PLATFORM_OPERATOR: "operator@example.invalid" });
    expect(() => assertRuntimeConfig()).toThrow("PLATFORM_OPERATOR must not be present");

    setProductionEnvironment({ PLATFORM_CROSS_TARGET_RESTORE: "YES" });
    expect(() => assertRuntimeConfig()).toThrow(
      "PLATFORM_CROSS_TARGET_RESTORE must not be present",
    );
  });

  it("rejects loopback auth origins outside the explicit E2E exception", () => {
    setProductionEnvironment({
      BETTER_AUTH_URL: "https://127.0.0.1",
      TRUSTED_ORIGINS: "https://127.0.0.1",
    });
    expect(() => assertRuntimeConfig()).toThrow("public HTTPS hostname");
  });

  it("rejects an auth URL that is not a bare origin", () => {
    setProductionEnvironment({ BETTER_AUTH_URL: "https://univ.example.com/app" });
    expect(() => assertRuntimeConfig()).toThrow("explicit origin");
  });

  it("rejects credentials embedded in a trusted origin", () => {
    setProductionEnvironment({ TRUSTED_ORIGINS: "https://user:password@univ.example.com" });
    expect(() => assertRuntimeConfig()).toThrow("explicit HTTPS origins");
  });

  it("does not let the E2E flag alone weaken production checks", () => {
    setProductionEnvironment({
      UNIV_E2E: "1",
      BETTER_AUTH_URL: "http://127.0.0.1:3021",
      TRUSTED_ORIGINS: "http://127.0.0.1:3021",
      DATABASE_URL: "postgresql://app:secret@db.example.internal:5432/univ",
    });
    expect(() => assertRuntimeConfig()).toThrow("sslmode=verify-full");
  });

  it("never permits an operator credential inside the web process, including E2E", () => {
    setProductionEnvironment({
      UNIV_E2E: "1",
      E2E_EXTERNAL_SERVER: "1",
      DATABASE_ADMIN_URL: "postgresql://owner:secret@127.0.0.1:5446/univ",
      DATABASE_URL: "postgresql://app:secret@127.0.0.1:5446/univ",
      BETTER_AUTH_URL: "http://127.0.0.1:3021",
      TRUSTED_ORIGINS: "http://127.0.0.1:3021",
    });
    expect(() => assertRuntimeConfig()).toThrow("DATABASE_ADMIN_URL must not be present");
  });

  it("permits loopback plain TCP only for the explicitly marked E2E server", () => {
    setProductionEnvironment({
      UNIV_E2E: "1",
      E2E_EXTERNAL_SERVER: "1",
      BETTER_AUTH_URL: "http://127.0.0.1:3021",
      TRUSTED_ORIGINS: "http://127.0.0.1:3021",
      DATABASE_URL: "postgresql://app:secret@127.0.0.1:5446/univ",
    });
    expect(() => assertRuntimeConfig()).not.toThrow();
  });
});
