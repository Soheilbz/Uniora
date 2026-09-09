import { createHash } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { councilDecisions, councilDecisionTransitions } from "@/db/schema.ts";
import { withTenant } from "@/db/tenant.ts";
import { writeAuditEventCore } from "@/lib/audit-writer-core.ts";
import { finalizeDocumentVersion } from "@/lib/documents/finalization.ts";
import { appendDomainEvent } from "@/lib/domain/events.ts";
import { isRecordVersion } from "@/lib/register/version.ts";
import { isUuid } from "@/lib/uuid.ts";
import { requireCapability } from "@/lib/viewer.ts";

export const COUNCIL_WORKFLOW_STATES = [
  "draft",
  "submitted",
  "administrative_review",
  "ready_for_council",
  "council_reviewed",
  "approved",
  "revision_required",
  "rejected",
  "finalized",
] as const;
export type CouncilWorkflowState = (typeof COUNCIL_WORKFLOW_STATES)[number];
const TRANSITIONS = {
  draft: ["submitted"],
  submitted: ["administrative_review", "draft"],
  administrative_review: ["ready_for_council", "revision_required"],
  ready_for_council: ["council_reviewed", "revision_required"],
  council_reviewed: ["approved", "revision_required", "rejected"],
  approved: ["finalized"],
  revision_required: ["submitted", "rejected"],
  rejected: [],
  finalized: [],
} satisfies Record<CouncilWorkflowState, readonly CouncilWorkflowState[]>;

export function nextCouncilStates(state: string): readonly CouncilWorkflowState[] {
  return isCouncilState(state) ? TRANSITIONS[state] : [];
}
export function isCouncilState(value: string): value is CouncilWorkflowState {
  return (COUNCIL_WORKFLOW_STATES as readonly string[]).includes(value);
}

export async function transitionCouncilDecision(form: FormData) {
  const viewer = await requireCapability("council.manage");
  const decisionId = String(form.get("decisionId") ?? "");
  const target = String(form.get("target") ?? "");
  const reason = String(form.get("reason") ?? "")
    .trim()
    .slice(0, 1000);
  const expectedVersion = Number.parseInt(String(form.get("version") ?? ""), 10);
  if (!isUuid(decisionId) || !isCouncilState(target) || !isRecordVersion(expectedVersion))
    return { ok: false as const, message: "invalid" };
  return withTenant(viewer.tenantId, async (tx) => {
    const [before] = await tx
      .select()
      .from(councilDecisions)
      .where(
        and(
          eq(councilDecisions.tenantId, viewer.tenantId),
          eq(councilDecisions.id, decisionId),
          isNull(councilDecisions.deletedAt),
        ),
      )
      .limit(1);
    if (!before) return { ok: false as const, message: "missing" };
    const from = isCouncilState(before.workflowState) ? before.workflowState : "draft";
    if (!(TRANSITIONS[from] as readonly CouncilWorkflowState[]).includes(target))
      return { ok: false as const, message: "invalid_transition" };
    if (before.version !== expectedVersion) return { ok: false as const, message: "conflict" };
    let finalizedVersionId = before.finalizedVersionId;
    if (target === "finalized") {
      const canonical = JSON.stringify({
        id: before.id,
        meetingNumber: before.meetingNumber,
        meetingDate: before.meetingDate,
        studentNumber: before.studentNumber,
        studentName: before.studentName,
        thesisCode: before.thesisCode,
        thesisTitle: before.thesisTitle,
        decisionText: before.decisionText,
        reviewStatus: before.reviewStatus,
        templateVersionId: before.templateVersionId,
      });
      const version = await finalizeDocumentVersion(tx, {
        tenantId: viewer.tenantId,
        documentType: "council-decision",
        documentId: decisionId,
        actorId: viewer.userId,
        contentSha256: createHash("sha256").update(canonical).digest("hex"),
        reason: reason || "Council decision finalization",
      });
      finalizedVersionId = version.id;
    }
    const [updated] = await tx
      .update(councilDecisions)
      .set({
        workflowState: target,
        finalizedVersionId,
        version: before.version + 1,
        updatedAt: new Date(),
      })
      .where(and(eq(councilDecisions.id, decisionId), eq(councilDecisions.version, before.version)))
      .returning({ id: councilDecisions.id, version: councilDecisions.version });
    if (!updated) return { ok: false as const, message: "conflict" };
    await tx.insert(councilDecisionTransitions).values({
      tenantId: viewer.tenantId,
      decisionId,
      fromState: from,
      toState: target,
      reason: reason || null,
      actorId: viewer.userId,
    });
    await writeAuditEventCore(tx, {
      tenantId: viewer.tenantId,
      actorId: viewer.userId,
      action: "workflow.transition",
      entityType: "council_decision",
      entityId: decisionId,
      changes: JSON.stringify({ workflowState: { from, to: target }, reason: reason || null }),
    });
    await appendDomainEvent(tx, viewer.tenantId, {
      type: target === "finalized" ? "CouncilDecisionFinalized" : "CouncilDecisionStateChanged",
      aggregateType: "council_decision",
      aggregateId: decisionId,
      payload: { from, to: target, reason: reason || null },
    });
    return { ok: true as const, version: updated.version };
  });
}
