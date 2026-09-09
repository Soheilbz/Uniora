import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/** Encrypts tenant integration/webhook configuration with a dedicated key. */
function key(): Buffer {
  const raw = process.env.INTEGRATION_ENCRYPTION_KEY?.trim();
  if (!raw || raw.length < 32)
    throw new Error("INTEGRATION_ENCRYPTION_KEY must contain at least 32 characters");
  return createHash("sha256").update(raw).digest();
}
export function encryptIntegrationSecret(value: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("base64url")}:${tag.toString("base64url")}:${ciphertext.toString("base64url")}`;
}
export function decryptIntegrationSecret(value: string): string {
  const [v, iv, tag, ciphertext] = value.split(":");
  if (v !== "v1" || !iv || !tag || !ciphertext)
    throw new Error("invalid integration secret envelope");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}
