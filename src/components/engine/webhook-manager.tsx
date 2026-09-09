"use client";

import { Copy, Pause, Play, RefreshCw, Webhook } from "lucide-react";
import { useActionState } from "react";
import { Badge } from "@/components/ui/badge.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card.tsx";
import { Input } from "@/components/ui/input.tsx";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table.tsx";
import {
  changeWebhookStatusAction,
  createWebhookSubscriptionAction,
  disableWebhookSubscriptionAction,
  rotateWebhookSecretAction,
  type WebhookActionState,
} from "@/modules/integrations/webhook-actions.ts";

interface EventOption {
  value: string;
  label: string;
}
interface Subscription {
  id: string;
  name: string;
  endpoint: string;
  eventTypes: string[];
  status: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}
interface Delivery {
  id: string;
  subscriptionName: string;
  status: string;
  attempt: number;
  responseStatus: number | null;
  nextAttemptAt: string | null;
  deliveredAt: string | null;
  createdAt: string;
}
interface Words {
  newTitle: string;
  name: string;
  endpoint: string;
  events: string;
  create: string;
  secretTitle: string;
  secretWarning: string;
  copy: string;
  active: string;
  paused: string;
  pause: string;
  resume: string;
  rotate: string;
  disable: string;
  noSubscriptions: string;
  deliveriesTitle: string;
  noDeliveries: string;
  delivery: string;
  attempts: string;
  response: string;
  nextAttempt: string;
  deliveredAt: string;
  never: string;
  invalid: string;
  stale: string;
  failed: string;
}

const INITIAL: WebhookActionState = { ok: false };

function parseEventTypes(raw: string): string[] {
  try {
    const value = JSON.parse(raw);
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

function SecretResult({ state, words }: { state: WebhookActionState; words: Words }) {
  if (!state.secret)
    return state.error ? (
      <p role="alert" className="text-sm text-destructive">
        {words[state.error]}
      </p>
    ) : null;
  return (
    <div className="grid gap-2 rounded-lg border border-warning/40 bg-warning/5 p-3">
      <p className="font-medium">{words.secretTitle}</p>
      <p className="text-sm text-muted-foreground">{words.secretWarning}</p>
      <div className="flex gap-2">
        <Input
          value={state.secret}
          readOnly
          dir="ltr"
          className="font-mono text-xs"
          aria-label={words.secretTitle}
        />
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={() => navigator.clipboard.writeText(state.secret ?? "")}
          aria-label={words.copy}
        >
          <Copy className="size-4" aria-hidden />
        </Button>
      </div>
    </div>
  );
}

function RotateSecret({ subscription, words }: { subscription: Subscription; words: Words }) {
  const [state, action, pending] = useActionState(rotateWebhookSecretAction, INITIAL);
  return (
    <div className="grid gap-2">
      <form action={action}>
        <input type="hidden" name="id" value={subscription.id} />
        <input type="hidden" name="version" value={subscription.version} />
        <Button type="submit" size="sm" variant="outline" disabled={pending}>
          <RefreshCw className="size-4" aria-hidden />
          {words.rotate}
        </Button>
      </form>
      <SecretResult state={state} words={words} />
    </div>
  );
}

export function WebhookManager({
  subscriptions,
  deliveries,
  eventOptions,
  words,
}: {
  subscriptions: Array<Omit<Subscription, "eventTypes"> & { eventTypes: string }>;
  deliveries: Delivery[];
  eventOptions: EventOption[];
  words: Words;
}) {
  const normalized = subscriptions.map((item) => ({
    ...item,
    eventTypes: parseEventTypes(item.eventTypes),
  }));
  const [state, action, pending] = useActionState(createWebhookSubscriptionAction, INITIAL);

  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{words.newTitle}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3">
          <form action={action} className="grid gap-3 md:grid-cols-2">
            <label className="grid gap-1 text-sm">
              <span>{words.name}</span>
              <Input name="name" required maxLength={120} />
            </label>
            <label className="grid gap-1 text-sm">
              <span>{words.endpoint}</span>
              <Input
                name="endpoint"
                type="url"
                inputMode="url"
                dir="ltr"
                required
                placeholder="https://example.edu/webhooks/univ-web"
              />
            </label>
            <fieldset className="grid gap-2 md:col-span-2">
              <legend className="text-sm">{words.events}</legend>
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {eventOptions.map((option) => (
                  <label
                    key={option.value}
                    className="flex items-start gap-2 rounded-lg border p-2 text-sm"
                  >
                    <input type="checkbox" name="eventType" value={option.value} className="mt-1" />
                    <span>
                      {option.label}
                      <code className="mt-0.5 block text-[11px] text-muted-foreground" dir="ltr">
                        {option.value}
                      </code>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="md:col-span-2 flex justify-end">
              <Button type="submit" disabled={pending}>
                <Webhook className="size-4" aria-hidden />
                {words.create}
              </Button>
            </div>
          </form>
          <SecretResult state={state} words={words} />
        </CardContent>
      </Card>

      <div className="grid gap-3">
        {normalized.length === 0 ? (
          <Card>
            <CardContent className="p-6 text-sm text-muted-foreground">
              {words.noSubscriptions}
            </CardContent>
          </Card>
        ) : null}
        {normalized.map((subscription) => (
          <Card key={subscription.id}>
            <CardContent className="grid gap-3 p-4 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-start">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium">{subscription.name}</p>
                  <Badge variant={subscription.status === "active" ? "default" : "outline"}>
                    {subscription.status === "active" ? words.active : words.paused}
                  </Badge>
                </div>
                <code className="mt-1 block break-all text-xs text-muted-foreground" dir="ltr">
                  {subscription.endpoint}
                </code>
                <div className="mt-2 flex flex-wrap gap-1">
                  {subscription.eventTypes.map((eventType) => (
                    <Badge key={eventType} variant="secondary" className="font-mono text-[10px]">
                      {eventType}
                    </Badge>
                  ))}
                </div>
              </div>
              <div className="flex flex-wrap items-start gap-2">
                <form action={changeWebhookStatusAction}>
                  <input type="hidden" name="id" value={subscription.id} />
                  <input type="hidden" name="version" value={subscription.version} />
                  <input
                    type="hidden"
                    name="status"
                    value={subscription.status === "active" ? "paused" : "active"}
                  />
                  <Button type="submit" size="sm" variant="outline">
                    {subscription.status === "active" ? (
                      <Pause className="size-4" aria-hidden />
                    ) : (
                      <Play className="size-4" aria-hidden />
                    )}
                    {subscription.status === "active" ? words.pause : words.resume}
                  </Button>
                </form>
                <RotateSecret subscription={subscription} words={words} />
                <form action={disableWebhookSubscriptionAction}>
                  <input type="hidden" name="id" value={subscription.id} />
                  <input type="hidden" name="version" value={subscription.version} />
                  <Button type="submit" size="sm" variant="destructive">
                    {words.disable}
                  </Button>
                </form>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{words.deliveriesTitle}</CardTitle>
        </CardHeader>
        <CardContent>
          {deliveries.length === 0 ? (
            <p className="text-sm text-muted-foreground">{words.noDeliveries}</p>
          ) : (
            <Table className="table-auto min-w-[760px] text-sm">
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>{words.delivery}</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>{words.attempts}</TableHead>
                  <TableHead>{words.response}</TableHead>
                  <TableHead>{words.nextAttempt}</TableHead>
                  <TableHead>{words.deliveredAt}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {deliveries.map((delivery) => (
                  <TableRow key={delivery.id}>
                    <TableCell>{delivery.subscriptionName}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{delivery.status}</Badge>
                    </TableCell>
                    <TableCell>{delivery.attempt}</TableCell>
                    <TableCell>{delivery.responseStatus ?? "—"}</TableCell>
                    <TableCell>{delivery.nextAttemptAt ?? "—"}</TableCell>
                    <TableCell>{delivery.deliveredAt ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
