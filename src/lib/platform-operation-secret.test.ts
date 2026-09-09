import { afterEach, describe, expect, it } from "vitest";
import {
  decryptPlatformOperationSecret,
  encryptPlatformOperationSecret,
} from "./platform-operation-secret.ts";

const originalKey = process.env.PLATFORM_OPERATION_ENCRYPTION_KEY;
const originalNodeEnv = process.env.NODE_ENV;
const mutableEnv = process.env as Record<string, string | undefined>;

afterEach(() => {
  if (originalKey === undefined) delete mutableEnv.PLATFORM_OPERATION_ENCRYPTION_KEY;
  else mutableEnv.PLATFORM_OPERATION_ENCRYPTION_KEY = originalKey;
  if (originalNodeEnv === undefined) delete mutableEnv.NODE_ENV;
  else mutableEnv.NODE_ENV = originalNodeEnv;
});

describe("platform operation credential envelope", () => {
  it("round-trips a queued credential without storing plaintext", () => {
    process.env.PLATFORM_OPERATION_ENCRYPTION_KEY =
      "test-platform-operation-key-0123456789-abcdefghijklmnopqrstuvwxyz";
    const encoded = encryptPlatformOperationSecret("temporary-password-123");
    expect(encoded).not.toContain("temporary-password-123");
    expect(decryptPlatformOperationSecret(encoded)).toBe("temporary-password-123");
  });

  it("fails closed when the configured key changes", () => {
    process.env.PLATFORM_OPERATION_ENCRYPTION_KEY =
      "first-platform-operation-key-0123456789-abcdefghijklmnopqrstuvwxyz";
    const encoded = encryptPlatformOperationSecret("temporary-password-123");
    process.env.PLATFORM_OPERATION_ENCRYPTION_KEY =
      "second-platform-operation-key-0123456789-abcdefghijklmnopqrstuvwxyz";
    expect(() => decryptPlatformOperationSecret(encoded)).toThrow();
  });
});
