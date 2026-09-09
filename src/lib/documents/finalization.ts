import { createHash } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { documentVersions } from "@/db/schema.ts";
import type { TenantTx } from "@/db/tenant.ts";
import { appendDomainEvent } from "@/lib/domain/events.ts";

export interface SignatureResult {
  provider: string;
  reference: string;
  contentSha256: string;
  /** Present when the provider returned a transformed signed artifact (for example PAdES). */
  signedContent?: Uint8Array;
  signedMimeType?: string;
}
export interface DocumentSigningProvider {
  sign(input: {
    tenantId: string;
    documentType: string;
    documentId: string;
    content: Uint8Array;
    sha256: string;
    mimeType: string;
  }): Promise<SignatureResult>;
}

export function sha256Bytes(content: Uint8Array): string {
  return createHash("sha256").update(content).digest("hex");
}

/**
 * Creates an immutable finalized version. Corrections create a new version and
 * supersede the old one; finalized bytes are never overwritten in place.
 */
export async function finalizeDocumentVersion(
  tx: TenantTx,
  input: {
    tenantId: string;
    documentType: string;
    documentId: string;
    actorId: string;
    contentSha256: string;
    attachmentId?: string | null;
    reason?: string | null;
    signature?: SignatureResult | null;
  },
) {
  const [previous] = await tx
    .select()
    .from(documentVersions)
    .where(
      and(
        eq(documentVersions.tenantId, input.tenantId),
        eq(documentVersions.documentType, input.documentType),
        eq(documentVersions.documentId, input.documentId),
        eq(documentVersions.status, "finalized"),
      ),
    )
    .orderBy(desc(documentVersions.versionNo))
    .limit(1);
  if (
    previous &&
    previous.contentSha256 === input.contentSha256 &&
    previous.attachmentId === (input.attachmentId ?? null)
  ) {
    const sameSignature = input.signature
      ? previous.signatureProvider === input.signature.provider &&
        previous.signatureReference === input.signature.reference
      : !previous.signatureReference;
    if (sameSignature) return previous;
  }
  const versionNo = (previous?.versionNo ?? 0) + 1;
  const [created] = await tx
    .insert(documentVersions)
    .values({
      tenantId: input.tenantId,
      documentType: input.documentType,
      documentId: input.documentId,
      versionNo,
      attachmentId: input.attachmentId ?? null,
      contentSha256: input.contentSha256,
      status: "finalized",
      supersedesVersionId: previous?.id ?? null,
      finalizedAt: new Date(),
      finalizedBy: input.actorId,
      finalizationReason: input.reason ?? null,
      signatureProvider: input.signature?.provider ?? null,
      signatureReference: input.signature?.reference ?? null,
    })
    .returning({ id: documentVersions.id, versionNo: documentVersions.versionNo });
  if (!created) throw new Error("failed to finalise document version");
  if (previous)
    await tx
      .update(documentVersions)
      .set({ status: "superseded", updatedAt: new Date() })
      .where(
        and(eq(documentVersions.tenantId, input.tenantId), eq(documentVersions.id, previous.id)),
      );
  await appendDomainEvent(tx, input.tenantId, {
    type: "OfficialDocumentFinalized",
    aggregateType: input.documentType,
    aggregateId: input.documentId,
    payload: { versionId: created.id, versionNo, sha256: input.contentSha256 },
  });
  return created;
}
