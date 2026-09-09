"use server";

import { requireCapability } from "@/lib/viewer.ts";
import { type DirectoryEntry, readDirectory } from "./roster.ts";

/** Server-backed professor search used by council comboboxes. */
export async function searchCouncilDirectory(query: string): Promise<DirectoryEntry[]> {
  const viewer = await requireCapability("council.manage");
  return readDirectory(viewer.tenantId, String(query ?? ""), 50);
}
