import type { NextRequest } from "next/server";
import { isTenantFeatureEnabled } from "@/lib/features.ts";
import { objectStorage } from "@/lib/storage/object-storage.ts";
import { requireViewer } from "@/lib/viewer.ts";
import { canAccessPortalAttachment } from "@/modules/portal/queries.ts";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await requireViewer();
  if (!(await isTenantFeatureEnabled(viewer.tenantId, "portals")))
    return new Response("Not found", { status: 404 });
  const { id } = await params;
  const row = await canAccessPortalAttachment(viewer, id);
  if (!row) return new Response("Not found", { status: 404 });
  try {
    return Response.redirect(await objectStorage().signedGetUrl(row.objectKey, 120), 302);
  } catch {
    return new Response("Document storage is unavailable", { status: 503 });
  }
}
