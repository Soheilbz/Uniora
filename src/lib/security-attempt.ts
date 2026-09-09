import { and, eq, sql } from "drizzle-orm";
import { redirect } from "next/navigation";
import { session } from "@/db/schema.ts";
import { withTenant } from "@/db/tenant.ts";
import { writeAuthAuditEvent } from "@/lib/auth-audit-writer.ts";
import { currentSession } from "./session.ts";

const SECURITY_FAILURE_LIMIT = 5;
const SECURITY_LOCK_MS = 5 * 60 * 1000;
export const SECURITY_ELEVATION_MS = 10 * 60 * 1000;

/** The authenticated session row used for a security-factor check. */
export async function currentSecuritySessionId(): Promise<string> {
  const current = await currentSession();
  const sessionId = current?.session?.id;
  if (!sessionId) redirect("/sign-in");
  return sessionId;
}

/** Whether this bearer session is temporarily blocked from another re-auth attempt. */
export async function securityAttemptLocked(
  tenantId: string,
  userId: string,
  sessionId: string,
): Promise<boolean> {
  const [row] = await withTenant(tenantId, (tx) =>
    tx
      .select({ lockedUntil: session.mfaLockedUntil })
      .from(session)
      .where(and(eq(session.id, sessionId), eq(session.userId, userId)))
      .limit(1),
  );
  return Boolean(row?.lockedUntil && row.lockedUntil > new Date());
}

/** Atomically charge one failed password/TOTP verification to the bearer session. */
export async function recordSecurityFailure(
  tenantId: string,
  userId: string,
  sessionId: string,
  action: string,
): Promise<"invalid" | "locked"> {
  return withTenant(tenantId, async (tx) => {
    const now = new Date();
    const lockUntil = new Date(now.getTime() + SECURITY_LOCK_MS);
    const [updated] = await tx
      .update(session)
      .set({
        mfaFailedCount: sql`least(20, ${session.mfaFailedCount} + 1)`,
        mfaLockedUntil: sql`case when ${session.mfaFailedCount} + 1 >= ${SECURITY_FAILURE_LIMIT} then ${lockUntil}::timestamptz else null end`,
        updatedAt: now,
      })
      .where(and(eq(session.id, sessionId), eq(session.userId, userId)))
      .returning({ lockedUntil: session.mfaLockedUntil });

    await writeAuthAuditEvent(tx, {
      tenantId,
      actorId: userId,
      subjectId: userId,
      action,
      entityType: "session",
      entityId: sessionId,
      outcome: "failure",
    });
    return updated?.lockedUntil ? "locked" : "invalid";
  });
}

/** Clear the common per-session re-auth brake after a successful verification. */
export async function clearSecurityFailures(
  tenantId: string,
  userId: string,
  sessionId: string,
  elevated = false,
): Promise<void> {
  const now = new Date();
  await withTenant(tenantId, (tx) =>
    tx
      .update(session)
      .set({
        mfaFailedCount: 0,
        mfaLockedUntil: null,
        elevatedUntil: elevated ? new Date(now.getTime() + SECURITY_ELEVATION_MS) : undefined,
        updatedAt: now,
      })
      .where(and(eq(session.id, sessionId), eq(session.userId, userId))),
  );
}
