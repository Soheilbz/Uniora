import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { session } from "@/db/schema.ts";
import { readOnly } from "@/db/tenant.ts";
import type { Viewer } from "./capabilities.ts";
import { safeInternalRedirectPath } from "./internal-redirect.ts";
import { currentSession } from "./session.ts";

/**
 * Sensitive actions always require a recently verified second factor,
 * regardless of the caller's role tier. Delegating a sensitive capability
 * therefore never weakens the authentication requirement for that action.
 */
export async function requireElevatedSession(viewer: Viewer, nextPath: string): Promise<void> {
  /* Tenant users do not have an MFA ceremony. The only MFA-protected session
     in the application is the tenantless platform operator session, which has
     its own guard in platform-viewer.ts. */
  if (!viewer.requireMfa) return;
  if (!viewer.mfaEnabled) redirect(`/security/setup`);
  const current = await currentSession();
  const sessionId = current?.session?.id;
  if (!sessionId) redirect("/sign-in");
  const [row] = await readOnly(viewer.tenantId, (tx) =>
    tx
      .select({ elevatedUntil: session.elevatedUntil })
      .from(session)
      .where(and(eq(session.id, sessionId), eq(session.userId, viewer.userId)))
      .limit(1),
  );
  if (!row?.elevatedUntil || row.elevatedUntil <= new Date()) {
    redirect(`/security/challenge?next=${encodeURIComponent(safeInternalRedirectPath(nextPath))}`);
  }
}
