"use server";
import { requireViewer } from "@/lib/viewer.ts";
import { isQuickEntityType, recordRecent, safeRecordHref, setPinned } from "./records.ts";
export async function touchRecentRecord(form: FormData) {
  const viewer = await requireViewer();
  const entityType = String(form.get("entityType") ?? "");
  const entityId = String(form.get("entityId") ?? "");
  const label = String(form.get("label") ?? "").trim();
  const href = String(form.get("href") ?? "");
  if (!isQuickEntityType(entityType) || !entityId || !safeRecordHref(href)) return;
  await recordRecent(viewer, entityType, entityId, label, href);
}
export async function togglePinnedRecord(form: FormData) {
  const viewer = await requireViewer();
  const entityType = String(form.get("entityType") ?? "");
  const entityId = String(form.get("entityId") ?? "");
  const label = String(form.get("label") ?? "").trim();
  const href = String(form.get("href") ?? "");
  const pinned = String(form.get("pinned") ?? "") === "true";
  if (!isQuickEntityType(entityType) || !entityId || !safeRecordHref(href)) return;
  await setPinned(viewer, entityType, entityId, label, href, pinned);
}
