import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const VERSION = "v1";
const AAD = "univ-platform-operation";

function key(): Buffer {
  const dedicated = process.env.PLATFORM_OPERATION_ENCRYPTION_KEY?.trim();
  const legacyDevelopmentFallback =
    process.env.NODE_ENV === "production" ? undefined : process.env.BETTER_AUTH_SECRET?.trim();
  const secret = dedicated || legacyDevelopmentFallback;
  if (!secret || secret.length < 32) {
    throw new Error(
      "PLATFORM_OPERATION_ENCRYPTION_KEY must be set and at least 32 characters long.",
    );
  }
  return createHash("sha256").update(`univ-platform-operation-key\0${secret}`, "utf8").digest();
}

/** Encrypt a short-lived credential before it enters the platform queue. */
export function encryptPlatformOperationSecret(value: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  cipher.setAAD(Buffer.from(AAD, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [
    VERSION,
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

/** Decrypt a queued credential only inside the privileged worker process. */
export function decryptPlatformOperationSecret(value: string): string {
  const [version, encodedIv, encodedTag, encodedCiphertext] = value.split(".");
  if (version !== VERSION || !encodedIv || !encodedTag || !encodedCiphertext) {
    throw new Error("invalid platform operation secret");
  }
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(encodedIv, "base64url"));
  decipher.setAAD(Buffer.from(AAD, "utf8"));
  decipher.setAuthTag(Buffer.from(encodedTag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encodedCiphertext, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}
