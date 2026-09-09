import { and, eq, isNull } from "drizzle-orm";
import { redirect } from "next/navigation";
import { cache } from "react";
import { db } from "@/db/client.ts";
import { session as authSession, platformOperators, user } from "@/db/schema.ts";
import { safeInternalRedirectPath } from "./internal-redirect.ts";
import { currentSession } from "./session.ts";

const DEFAULT_PLATFORM_SESSION_HOURS = 4;
const MAX_PLATFORM_SESSION_HOURS = 8;

export interface PlatformViewer {
  userId: string;
  name: string;
  username: string;
  sessionId: string;
  mfaEnabled: boolean;
  mfaVerified: boolean;
  elevatedUntil: Date | null;
}

function platformSessionHours(): number {
  const configured = process.env.PLATFORM_SESSION_HOURS?.trim();
  if (!configured) return DEFAULT_PLATFORM_SESSION_HOURS;
  const parsed = Number(configured);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_PLATFORM_SESSION_HOURS) {
    throw new Error(
      `PLATFORM_SESSION_HOURS must be an integer between 1 and ${MAX_PLATFORM_SESSION_HOURS}`,
    );
  }
  return parsed;
}

/**
 * Resolve an installation operator without manufacturing a tenant context.
 *
 * This is deliberately the *identity* gate, not the final Platform Console
 * gate. MFA setup/challenge pages need to identify the signed-in operator even
 * while the second factor has not yet been enrolled or verified. Call
 * `requirePlatformConsoleOperator` for ordinary platform pages and
 * `requirePlatformElevatedSession` immediately before a privileged request.
 */
export const currentPlatformOperator = cache(async (): Promise<PlatformViewer | null> => {
  const current = await currentSession();
  const userId = current?.user?.id;
  const sessionId = current?.session?.id;
  if (!userId || !sessionId) return null;

  const [operator] = await db()
    .select({
      userId: user.id,
      name: user.name,
      username: user.displayUsername,
      mfaEnabled: user.mfaEnabled,
      accountExpiresAt: user.accountExpiresAt,
      sessionCreatedAt: authSession.createdAt,
      sessionExpiresAt: authSession.expiresAt,
      mfaVerifiedAt: authSession.mfaVerifiedAt,
      elevatedUntil: authSession.elevatedUntil,
    })
    .from(platformOperators)
    .innerJoin(user, eq(user.id, platformOperators.userId))
    .innerJoin(
      authSession,
      and(eq(authSession.id, sessionId), eq(authSession.userId, platformOperators.userId)),
    )
    .where(
      and(eq(platformOperators.userId, userId), isNull(user.tenantId), isNull(user.suspendedAt)),
    )
    .limit(1);

  if (!operator?.username) return null;
  const now = new Date();
  if (operator.accountExpiresAt && operator.accountExpiresAt <= now) return null;
  if (operator.sessionExpiresAt <= now) return null;
  if (
    operator.sessionCreatedAt.getTime() + platformSessionHours() * 60 * 60 * 1000 <=
    now.getTime()
  ) {
    return null;
  }

  return {
    userId: operator.userId,
    name: operator.name,
    username: operator.username,
    sessionId,
    mfaEnabled: operator.mfaEnabled,
    mfaVerified: Boolean(operator.mfaVerifiedAt),
    elevatedUntil: operator.elevatedUntil,
  };
});

/** Identify a signed-in platform operator, including during MFA enrollment. */
export async function requirePlatformOperator(): Promise<PlatformViewer> {
  const operator = await currentPlatformOperator();
  if (!operator) redirect("/platform/sign-in");
  return operator;
}

/** Require the mandatory second factor before any Platform Console surface. */
export async function requirePlatformConsoleOperator(
  nextPath = "/platform",
): Promise<PlatformViewer> {
  const operator = await requirePlatformOperator();
  if (!operator.mfaEnabled) redirect("/platform/security/setup");
  if (!operator.mfaVerified) {
    redirect(`/platform/security/challenge?next=${encodeURIComponent(platformNextPath(nextPath))}`);
  }
  return operator;
}

/**
 * Require a recently verified second factor immediately before an operation
 * that can alter installation-wide state. The returned session id is recorded
 * with the queue request and re-checked by the privileged worker.
 */
export async function requirePlatformElevatedSession(
  nextPath = "/platform",
): Promise<PlatformViewer> {
  const operator = await requirePlatformConsoleOperator(nextPath);
  if (!operator.elevatedUntil || operator.elevatedUntil <= new Date()) {
    redirect(`/platform/security/challenge?next=${encodeURIComponent(platformNextPath(nextPath))}`);
  }
  return operator;
}

export function platformNextPath(value: string): string {
  return safeInternalRedirectPath(value, { fallback: "/platform", pathnamePrefix: "/platform" });
}
