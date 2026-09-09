import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { foldDigits } from "@/lib/digits.ts";

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const STEP_SECONDS = 30;
const DIGITS = 6;
const KEY_ID = /^[A-Za-z0-9._-]{1,40}$/;

interface MfaKeyring {
  activeId: string;
  keys: Map<string, Buffer>;
}

function hashedKey(secret: string): Buffer {
  return createHash("sha256").update(secret).digest();
}

/**
 * MFA keyring.
 *
 * New deployments should set MFA_ENCRYPTION_KEYS to a JSON object and
 * MFA_ACTIVE_KEY_ID to one of its keys. MFA_ENCRYPTION_KEY remains a supported
 * single-key compatibility input; it is represented internally as key id
 * `legacy` so even new envelopes carry an explicit key id.
 */
export function mfaKeyring(): MfaKeyring {
  const rawRing = process.env.MFA_ENCRYPTION_KEYS?.trim();
  const legacy = process.env.MFA_ENCRYPTION_KEY?.trim();
  const keys = new Map<string, Buffer>();

  if (rawRing) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawRing);
    } catch {
      throw new Error("MFA_ENCRYPTION_KEYS must be a JSON object of keyId -> secret");
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("MFA_ENCRYPTION_KEYS must be a JSON object of keyId -> secret");
    }
    for (const [id, value] of Object.entries(parsed)) {
      if (!KEY_ID.test(id)) throw new Error(`Invalid MFA key id: ${id}`);
      if (typeof value !== "string" || value.length < 32) {
        throw new Error(`MFA encryption key ${id} must contain at least 32 characters`);
      }
      keys.set(id, hashedKey(value));
    }
  }

  if (legacy) {
    if (legacy.length < 32)
      throw new Error("MFA_ENCRYPTION_KEY must contain at least 32 characters");
    if (!keys.has("legacy")) keys.set("legacy", hashedKey(legacy));
  }

  if (keys.size === 0) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("MFA_ENCRYPTION_KEYS or MFA_ENCRYPTION_KEY is required in production");
    }
    keys.set("development", hashedKey("univ-web-development-mfa-key-32-chars-minimum"));
  }

  const requested = process.env.MFA_ACTIVE_KEY_ID?.trim();
  const activeId = requested || (rawRing ? "" : legacy ? "legacy" : "development");
  if (!activeId || !KEY_ID.test(activeId) || !keys.has(activeId)) {
    throw new Error("MFA_ACTIVE_KEY_ID must name a key present in MFA_ENCRYPTION_KEYS");
  }
  return { activeId, keys };
}

export function activeMfaKeyId(): string {
  return mfaKeyring().activeId;
}

export function generateMfaSecret(): string {
  return encodeBase32(randomBytes(20));
}

export function encryptMfaSecret(secret: string): string {
  const ring = mfaKeyring();
  const key = ring.keys.get(ring.activeId);
  if (!key) throw new Error("MFA active key is unavailable");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v2:${ring.activeId}:${iv.toString("base64url")}:${tag.toString("base64url")}:${encrypted.toString("base64url")}`;
}

function decryptWith(key: Buffer, ivText: string, tagText: string, encryptedText: string): string {
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivText, "base64url"));
  decipher.setAuthTag(Buffer.from(tagText, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedText, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

export function decryptMfaSecret(value: string): string {
  const parts = value.split(":");
  const ring = mfaKeyring();
  if (parts[0] === "v2") {
    const [, keyId, ivText, tagText, encryptedText] = parts;
    if (!keyId || !ivText || !tagText || !encryptedText || parts.length !== 5) {
      throw new Error("Invalid MFA secret envelope");
    }
    const key = ring.keys.get(keyId);
    if (!key) throw new Error(`MFA secret references unavailable key id ${keyId}`);
    return decryptWith(key, ivText, tagText, encryptedText);
  }

  if (parts[0] === "v1") {
    const [, ivText, tagText, encryptedText] = parts;
    if (!ivText || !tagText || !encryptedText || parts.length !== 4) {
      throw new Error("Invalid MFA secret envelope");
    }
    // v1 carried no key id. During rotation, try every configured historical
    // key; authentication of AES-GCM makes a wrong key fail closed.
    for (const key of ring.keys.values()) {
      try {
        return decryptWith(key, ivText, tagText, encryptedText);
      } catch {
        // try the next historical key
      }
    }
    throw new Error("MFA v1 secret could not be decrypted with the configured keyring");
  }
  throw new Error("Invalid MFA secret envelope");
}

export function mfaEnvelopeKeyId(value: string): string | null {
  const [version, keyId] = value.split(":");
  return version === "v2" && keyId ? keyId : null;
}

export function needsMfaReencrypt(value: string): boolean {
  return mfaEnvelopeKeyId(value) !== activeMfaKeyId();
}

export function reencryptMfaSecret(value: string): string {
  return encryptMfaSecret(decryptMfaSecret(value));
}

export function verifyTotp(secret: string, candidate: string, now = Date.now()): boolean {
  const normalized = foldDigits(candidate.trim());
  if (!/^\d{6}$/.test(normalized) || !Number.isFinite(now) || now < 0) return false;
  const counter = Math.floor(now / 1000 / STEP_SECONDS);
  for (let offset = -1; offset <= 1; offset += 1) {
    const candidateCounter = counter + offset;
    if (candidateCounter < 0) continue;
    const expected = totp(secret, candidateCounter);
    if (timingSafeEqual(Buffer.from(expected), Buffer.from(normalized))) return true;
  }
  return false;
}

export function mfaOtpAuthUri(secret: string, tenant: string, username: string): string {
  const label = encodeURIComponent(`${tenant}:${username}`);
  const issuer = encodeURIComponent("University Administration");
  return `otpauth://totp/${label}?secret=${encodeURIComponent(secret)}&issuer=${issuer}&algorithm=SHA1&digits=${DIGITS}&period=${STEP_SECONDS}`;
}

function totp(secret: string, counter: number): string {
  const key = decodeBase32(secret);
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", key).update(message).digest();
  const offset = (digest[digest.length - 1] ?? 0) & 0x0f;
  const first = digest[offset] ?? 0;
  const second = digest[offset + 1] ?? 0;
  const third = digest[offset + 2] ?? 0;
  const fourth = digest[offset + 3] ?? 0;
  const binary =
    ((first & 0x7f) << 24) | ((second & 0xff) << 16) | ((third & 0xff) << 8) | (fourth & 0xff);
  return String(binary % 10 ** DIGITS).padStart(DIGITS, "0");
}

function encodeBase32(input: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of input) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32[(value << (5 - bits)) & 31];
  return output;
}

function decodeBase32(input: string): Buffer {
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of input.toUpperCase().replace(/=+$/g, "")) {
    const index = BASE32.indexOf(char);
    if (index < 0) throw new Error("Invalid base32 secret");
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}
