import type { NextRequest } from "next/server";
import { objectStorage } from "@/lib/storage/object-storage.ts";
import { requireCapability } from "@/lib/viewer.ts";
import { readManagedAttachmentDownload } from "@/modules/documents/download.ts";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await requireCapability("documents.view");
  const { id } = await params;
  const row = await readManagedAttachmentDownload(viewer, id);
  if (!row) {
    return new Response("Not found", { status: 404 });
  }
  try {
    const url = await objectStorage().signedGetUrl(row.objectKey, 120);
    return Response.redirect(url, 302);
  } catch {
    return new Response("Document storage is unavailable", { status: 503 });
  }
}
