"use client";
import { useActionState } from "react";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import {
  type CalendarSubscriptionCreateState,
  createCalendarSubscriptionAction,
} from "@/modules/calendar/subscription-actions.ts";

export function SubscriptionForm({
  words,
  origin,
}: {
  words: { name: string; create: string; once: string; error: string };
  origin: string;
}) {
  const [state, action, pending] = useActionState<CalendarSubscriptionCreateState | null, FormData>(
    createCalendarSubscriptionAction,
    null,
  );
  const url = state?.token ? `${origin}/calendar-feed/${state.token}` : null;
  return (
    <div className="grid gap-3">
      <form action={action} className="grid gap-3 sm:grid-cols-[1fr_12rem_auto]">
        <Input name="name" required maxLength={120} placeholder={words.name} />
        <Input name="expiresAt" type="date" dir="ltr" aria-label={words.once} title={words.once} />
        <Button type="submit" disabled={pending}>
          {words.create}
        </Button>
      </form>
      {url ? (
        <div className="grid gap-1 rounded-lg border bg-muted/30 p-3">
          <p className="text-xs text-muted-foreground">{words.once}</p>
          <code className="break-all text-xs" dir="ltr">
            {url}
          </code>
        </div>
      ) : null}
      {state && !state.ok ? (
        <p className="text-xs text-destructive" role="alert">
          {words.error}
        </p>
      ) : null}
    </div>
  );
}
