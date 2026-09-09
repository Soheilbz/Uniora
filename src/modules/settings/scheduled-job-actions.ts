"use server";

import { revalidatePath } from "next/cache";
import { requireCapability } from "@/lib/viewer.ts";
import {
  createScheduledJob,
  retireScheduledJob,
  setScheduledJobEnabled,
} from "./scheduled-jobs.ts";

export interface ScheduledJobActionState {
  ok: boolean;
  error?: "invalid" | "stale" | "failed";
}

const PATH = "/settings/scheduled-jobs";

function versionOf(form: FormData): number | null {
  const value = Number(form.get("version"));
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

export async function createScheduledJobAction(
  _previous: ScheduledJobActionState,
  form: FormData,
): Promise<ScheduledJobActionState> {
  const viewer = await requireCapability("reports.schedule");
  const name = String(form.get("name") ?? "").trim();
  const kind = String(form.get("kind") ?? "");
  const recurrenceType = String(form.get("recurrenceType") ?? "");
  const intervalMinutes = Number(form.get("intervalMinutes") ?? 0);
  const at = String(form.get("at") ?? "");
  const weekdays = form.getAll("weekday").map(Number);
  const timezone = String(form.get("timezone") ?? viewer.tenantTimezone ?? "UTC");
  if (name.length < 2 || !kind || !recurrenceType) return { ok: false, error: "invalid" };
  try {
    await createScheduledJob(viewer, {
      name,
      kind,
      recurrenceType,
      intervalMinutes,
      at,
      weekdays,
      timezone,
      reminderTitle: String(form.get("reminderTitle") ?? ""),
      reminderBody: String(form.get("reminderBody") ?? ""),
      reminderHref: String(form.get("reminderHref") ?? ""),
    });
    revalidatePath(PATH);
    return { ok: true };
  } catch {
    return { ok: false, error: "failed" };
  }
}

export async function setScheduledJobEnabledAction(form: FormData): Promise<void> {
  const viewer = await requireCapability("reports.schedule");
  const id = String(form.get("id") ?? "");
  const version = versionOf(form);
  const enabled = String(form.get("enabled") ?? "") === "true";
  if (!id || !version) return;
  await setScheduledJobEnabled(viewer, id, version, enabled);
  revalidatePath(PATH);
}

export async function retireScheduledJobAction(form: FormData): Promise<void> {
  const viewer = await requireCapability("reports.schedule");
  const id = String(form.get("id") ?? "");
  const version = versionOf(form);
  if (!id || !version) return;
  await retireScheduledJob(viewer, id, version);
  revalidatePath(PATH);
}
