"use server";

import { and, eq, ne, sql } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import QRCode from "qrcode";
import { db } from "@/db/client.ts";
import { session, user } from "@/db/schema.ts";
import { auth } from "@/lib/auth.ts";
import {
  decryptMfaSecret,
  encryptMfaSecret,
  generateMfaSecret,
  mfaOtpAuthUri,
  verifyTotp,
} from "@/lib/mfa.ts";
import { PASSWORD_MAXIMUM_LENGTH } from "@/lib/password-policy.ts";
import { platformNextPath, requirePlatformOperator } from "@/lib/platform-viewer.ts";
import { SECURITY_ELEVATION_MS } from "@/lib/security-attempt.ts";

const PLATFORM_SECURITY_FAILURE_LIMIT = 5;
const PLATFORM_SECURITY_LOCK_MS = 5 * 60 * 1000;

export interface PlatformMfaEnrollmentResult {
  ok: boolean;
  secret?: string;
  uri?: string;
  qrCodeDataUrl?: string;
  error?: "alreadyEnabled" | "passwordRequired" | "passwordWrong" | "locked" | "saveFailed";
}

async function platformSecurityLocked(userId: string, sessionId: string): Promise<boolean> {
  const [row] = await db()
    .select({ lockedUntil: session.mfaLockedUntil })
    .from(session)
    .where(and(eq(session.id, sessionId), eq(session.userId, userId)))
    .limit(1);
  return Boolean(row?.lockedUntil && row.lockedUntil > new Date());
}

async function recordPlatformSecurityFailure(
  userId: string,
  sessionId: string,
): Promise<"invalid" | "locked"> {
  const now = new Date();
  const lockUntil = new Date(now.getTime() + PLATFORM_SECURITY_LOCK_MS);
  const [updated] = await db()
    .update(session)
    .set({
      mfaFailedCount: sql`least(20, ${session.mfaFailedCount} + 1)`,
      mfaLockedUntil: sql`case when ${session.mfaFailedCount} + 1 >= ${PLATFORM_SECURITY_FAILURE_LIMIT} then ${lockUntil}::timestamptz else null end`,
      updatedAt: now,
    })
    .where(and(eq(session.id, sessionId), eq(session.userId, userId)))
    .returning({ lockedUntil: session.mfaLockedUntil });
  return updated?.lockedUntil ? "locked" : "invalid";
}

async function clearPlatformSecurityFailures(
  userId: string,
  sessionId: string,
  elevated: boolean,
): Promise<void> {
  const now = new Date();
  await db()
    .update(session)
    .set({
      mfaFailedCount: 0,
      mfaLockedUntil: null,
      elevatedUntil: elevated ? new Date(now.getTime() + SECURITY_ELEVATION_MS) : undefined,
      updatedAt: now,
    })
    .where(and(eq(session.id, sessionId), eq(session.userId, userId)));
}

/** Start mandatory Platform MFA enrollment only after password re-authentication. */
export async function beginPlatformMfaEnrollment(
  _previous: PlatformMfaEnrollmentResult | null,
  form: FormData,
): Promise<PlatformMfaEnrollmentResult> {
  const operator = await requirePlatformOperator();
  if (operator.mfaEnabled) return { ok: false, error: "alreadyEnabled" };

  const password = String(form.get("currentPassword") ?? "");
  if (!password || password.length > PASSWORD_MAXIMUM_LENGTH) {
    return { ok: false, error: "passwordRequired" };
  }
  if (await platformSecurityLocked(operator.userId, operator.sessionId)) {
    return { ok: false, error: "locked" };
  }

  try {
    await auth.api.verifyPassword({ body: { password }, headers: await headers() });
  } catch {
    const state = await recordPlatformSecurityFailure(operator.userId, operator.sessionId);
    return { ok: false, error: state === "locked" ? "locked" : "passwordWrong" };
  }
  await clearPlatformSecurityFailures(operator.userId, operator.sessionId, true);

  const secret = generateMfaSecret();
  const encrypted = encryptMfaSecret(secret);
  const uri = mfaOtpAuthUri(secret, "univ-platform", operator.username);
  const qrCodeDataUrl = await QRCode.toDataURL(uri, {
    errorCorrectionLevel: "M",
    margin: 1,
    width: 220,
  });
  const [saved] = await db()
    .update(user)
    .set({ mfaPendingSecretEncrypted: encrypted, updatedAt: new Date() })
    .where(and(eq(user.id, operator.userId), eq(user.mfaEnabled, false)))
    .returning({ id: user.id });
  if (!saved) return { ok: false, error: "saveFailed" };

  return {
    ok: true,
    secret,
    uri,
    qrCodeDataUrl,
  };
}

/** Confirm enrollment and make the current bearer session the only surviving one. */
export async function confirmPlatformMfaEnrollment(form: FormData): Promise<void> {
  const operator = await requirePlatformOperator();
  if (operator.mfaEnabled) redirect("/platform/security/challenge?next=/platform");
  const code = String(form.get("code") ?? "").trim();

  if (await platformSecurityLocked(operator.userId, operator.sessionId)) {
    redirect("/platform/security/setup?error=locked");
  }

  const [account] = await db()
    .select({ pending: user.mfaPendingSecretEncrypted })
    .from(user)
    .where(eq(user.id, operator.userId))
    .limit(1);
  if (!account?.pending || !verifyTotp(decryptMfaSecret(account.pending), code)) {
    const state = await recordPlatformSecurityFailure(operator.userId, operator.sessionId);
    redirect(`/platform/security/setup?error=${state === "locked" ? "locked" : "invalid-code"}`);
  }

  const now = new Date();
  await db().transaction(async (tx) => {
    await tx
      .update(user)
      .set({
        mfaEnabled: true,
        mfaSecretEncrypted: account.pending,
        mfaPendingSecretEncrypted: null,
        updatedAt: now,
      })
      .where(eq(user.id, operator.userId));
    await tx
      .delete(session)
      .where(and(eq(session.userId, operator.userId), ne(session.id, operator.sessionId)));
    await tx
      .update(session)
      .set({
        mfaVerifiedAt: now,
        elevatedUntil: new Date(now.getTime() + SECURITY_ELEVATION_MS),
        mfaFailedCount: 0,
        mfaLockedUntil: null,
        updatedAt: now,
      })
      .where(and(eq(session.id, operator.sessionId), eq(session.userId, operator.userId)));
  });
  redirect("/platform");
}

/** Verify mandatory MFA and renew the short privileged-action window. */
export async function verifyPlatformMfaChallenge(form: FormData): Promise<void> {
  const operator = await requirePlatformOperator();
  if (!operator.mfaEnabled) redirect("/platform/security/setup");
  const code = String(form.get("code") ?? "").trim();

  if (await platformSecurityLocked(operator.userId, operator.sessionId)) {
    redirect("/platform/security/challenge?error=locked");
  }

  const [account] = await db()
    .select({ secret: user.mfaSecretEncrypted, enabled: user.mfaEnabled })
    .from(user)
    .where(eq(user.id, operator.userId))
    .limit(1);
  if (!account?.enabled || !account.secret || !verifyTotp(decryptMfaSecret(account.secret), code)) {
    const state = await recordPlatformSecurityFailure(operator.userId, operator.sessionId);
    redirect(
      `/platform/security/challenge?error=${state === "locked" ? "locked" : "invalid-code"}`,
    );
  }

  const now = new Date();
  await db()
    .update(session)
    .set({
      mfaVerifiedAt: now,
      elevatedUntil: new Date(now.getTime() + SECURITY_ELEVATION_MS),
      mfaFailedCount: 0,
      mfaLockedUntil: null,
      updatedAt: now,
    })
    .where(and(eq(session.id, operator.sessionId), eq(session.userId, operator.userId)));

  const next = platformNextPath(String(form.get("next") ?? "/platform"));
  redirect(next);
}
