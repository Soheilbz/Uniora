import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  decryptMfaSecret,
  encryptMfaSecret,
  mfaEnvelopeKeyId,
  needsMfaReencrypt,
  reencryptMfaSecret,
  verifyTotp,
} from "./mfa.ts";

const OLD = "old-mfa-key-material-0123456789abcdef-rotation";
const NEW = "new-mfa-key-material-0123456789abcdef-rotation";

afterEach(() => vi.unstubAllEnvs());

function configure(active: "old" | "new") {
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("MFA_ENCRYPTION_KEY", "");
  vi.stubEnv("MFA_ENCRYPTION_KEYS", JSON.stringify({ old: OLD, new: NEW }));
  vi.stubEnv("MFA_ACTIVE_KEY_ID", active);
}

function legacyV1(secret: string, keyMaterial: string): string {
  const key = createHash("sha256").update(keyMaterial).digest();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("base64url")}:${tag.toString("base64url")}:${encrypted.toString("base64url")}`;
}

describe("MFA encryption keyring rotation", () => {
  it("reads a v1 envelope with a historical key and rewrites it under the active key id", () => {
    const secret = "JBSWY3DPEHPK3PXP";
    configure("new");
    const oldEnvelope = legacyV1(secret, OLD);
    expect(decryptMfaSecret(oldEnvelope)).toBe(secret);
    expect(needsMfaReencrypt(oldEnvelope)).toBe(true);

    const rotated = reencryptMfaSecret(oldEnvelope);
    expect(mfaEnvelopeKeyId(rotated)).toBe("new");
    expect(decryptMfaSecret(rotated)).toBe(secret);
  });

  it("marks an envelope from a retired active id for re-encryption", () => {
    configure("old");
    const oldEnvelope = encryptMfaSecret("ABCDEFGHIJKLMNOP");
    expect(mfaEnvelopeKeyId(oldEnvelope)).toBe("old");

    configure("new");
    expect(needsMfaReencrypt(oldEnvelope)).toBe(true);
    const rotated = reencryptMfaSecret(oldEnvelope);
    expect(mfaEnvelopeKeyId(rotated)).toBe("new");
    expect(decryptMfaSecret(rotated)).toBe("ABCDEFGHIJKLMNOP");
  });
});

describe("TOTP input normalization", () => {
  const secret = "JBSWY3DPEHPK3PXP";
  const now = 59_000;

  it("accepts the same six-digit code from Latin, Persian, or Arabic-Indic keyboards", () => {
    expect(verifyTotp(secret, "996554", now)).toBe(true);
    expect(verifyTotp(secret, "۹۹۶۵۵۴", now)).toBe(true);
    expect(verifyTotp(secret, "٩٩٦٥٥٤", now)).toBe(true);
    expect(verifyTotp(secret, "  ۹۹۶۵۵۴  ", now)).toBe(true);
  });

  it("rejects malformed codes and invalid clock values without reaching a negative counter", () => {
    expect(verifyTotp(secret, "99655", now)).toBe(false);
    expect(verifyTotp(secret, "99A554", now)).toBe(false);
    expect(verifyTotp(secret, "282760", -1)).toBe(false);
    expect(verifyTotp(secret, "282760", Number.POSITIVE_INFINITY)).toBe(false);
    expect(verifyTotp(secret, "282760", 0)).toBe(true);
  });
});
