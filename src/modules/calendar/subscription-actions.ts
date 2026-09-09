"use server";
import { revalidatePath } from "next/cache";
import { requireCapability } from "@/lib/viewer.ts";
import { createCalendarSubscription, revokeCalendarSubscription } from "./subscriptions.ts";

export interface CalendarSubscriptionCreateState {
  ok: boolean;
  token?: string;
  message?: string;
}

export async function createCalendarSubscriptionAction(
  _previous: CalendarSubscriptionCreateState | null,
  form: FormData,
): Promise<CalendarSubscriptionCreateState> {
  const viewer = await requireCapability("calendar.view");
  const expiresRaw = String(form.get("expiresAt") ?? "").trim();
  const expiresAt = expiresRaw ? new Date(`${expiresRaw}T23:59:59Z`) : null;
  try {
    const created = await createCalendarSubscription(viewer, {
      name: String(form.get("name") ?? ""),
      expiresAt,
    });
    revalidatePath("/calendar/subscriptions");
    return { ok: true, token: created.token };
  } catch {
    return { ok: false, message: "invalid" };
  }
}

export async function revokeCalendarSubscriptionAction(form: FormData): Promise<void> {
  const viewer = await requireCapability("calendar.view");
  await revokeCalendarSubscription(viewer, String(form.get("id") ?? ""));
  revalidatePath("/calendar/subscriptions");
}
