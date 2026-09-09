"use client";

import { CalendarClock, Pause, Play, Trash2 } from "lucide-react";
import { useActionState, useState } from "react";
import { Badge } from "@/components/ui/badge.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card.tsx";
import { Input } from "@/components/ui/input.tsx";
import {
  createScheduledJobAction,
  retireScheduledJobAction,
  type ScheduledJobActionState,
  setScheduledJobEnabledAction,
} from "@/modules/settings/scheduled-job-actions.ts";

interface JobOption {
  value: string;
  label: string;
}
interface ExistingJob {
  id: string;
  name: string;
  kind: string;
  schedule: string;
  timezone: string;
  enabled: boolean;
  nextRunAt: string | null;
  lastRunAt: string | null;
  version: number;
}
interface Words {
  newTitle: string;
  name: string;
  kind: string;
  recurrence: string;
  interval: string;
  daily: string;
  weekly: string;
  everyMinutes: string;
  at: string;
  weekdays: string;
  timezone: string;
  reminderTitle: string;
  reminderBody: string;
  reminderHref: string;
  create: string;
  active: string;
  paused: string;
  pause: string;
  resume: string;
  retire: string;
  nextRun: string;
  lastRun: string;
  never: string;
  empty: string;
  invalid: string;
  stale: string;
  failed: string;
  weekdayLabels: string[];
}
const INITIAL: ScheduledJobActionState = { ok: false };

export function ScheduledJobManager({
  jobs,
  jobOptions,
  defaultTimezone,
  words,
}: {
  jobs: ExistingJob[];
  jobOptions: JobOption[];
  defaultTimezone: string;
  words: Words;
}) {
  const [state, action, pending] = useActionState(createScheduledJobAction, INITIAL);
  const [recurrence, setRecurrence] = useState("daily");
  const [kind, setKind] = useState(jobOptions[0]?.value ?? "");
  const reminder = kind === "notification.reminder";
  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{words.newTitle}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3">
          <form action={action} className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <label className="grid gap-1 text-sm">
              <span>{words.name}</span>
              <Input name="name" required maxLength={120} />
            </label>
            <label className="grid gap-1 text-sm">
              <span>{words.kind}</span>
              <select
                name="kind"
                value={kind}
                onChange={(event) => setKind(event.target.value)}
                className="h-9 rounded-md border bg-background px-3 text-sm"
              >
                {jobOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-sm">
              <span>{words.recurrence}</span>
              <select
                name="recurrenceType"
                value={recurrence}
                onChange={(event) => setRecurrence(event.target.value)}
                className="h-9 rounded-md border bg-background px-3 text-sm"
              >
                <option value="interval">{words.interval}</option>
                <option value="daily">{words.daily}</option>
                <option value="weekly">{words.weekly}</option>
              </select>
            </label>
            <label className="grid gap-1 text-sm">
              <span>{words.timezone}</span>
              <Input name="timezone" defaultValue={defaultTimezone} dir="ltr" required />
            </label>
            {recurrence === "interval" ? (
              <label className="grid gap-1 text-sm">
                <span>{words.everyMinutes}</span>
                <Input
                  name="intervalMinutes"
                  type="number"
                  min="1"
                  max="525600"
                  defaultValue="60"
                  required
                />
              </label>
            ) : null}
            {recurrence !== "interval" ? (
              <label className="grid gap-1 text-sm">
                <span>{words.at}</span>
                <Input name="at" type="time" defaultValue="08:00" required />
              </label>
            ) : null}
            {recurrence === "weekly" ? (
              <fieldset className="grid gap-1 text-sm md:col-span-2">
                <legend>{words.weekdays}</legend>
                <div className="flex flex-wrap gap-2">
                  {words.weekdayLabels.map((label, index) => (
                    <label
                      key={label}
                      className="flex items-center gap-1 rounded-md border px-2 py-1"
                    >
                      <input type="checkbox" name="weekday" value={index + 1} />
                      <span>{label}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
            ) : null}
            {reminder ? (
              <>
                <label className="grid gap-1 text-sm md:col-span-2">
                  <span>{words.reminderTitle}</span>
                  <Input name="reminderTitle" maxLength={180} required />
                </label>
                <label className="grid gap-1 text-sm md:col-span-2">
                  <span>{words.reminderBody}</span>
                  <Input name="reminderBody" maxLength={1000} />
                </label>
                <label className="grid gap-1 text-sm md:col-span-2">
                  <span>{words.reminderHref}</span>
                  <Input name="reminderHref" dir="ltr" placeholder="/tasks" maxLength={500} />
                </label>
              </>
            ) : null}
            <div className="md:col-span-2 xl:col-span-4 flex items-center justify-between gap-3">
              <div>
                {state.error ? (
                  <p role="alert" className="text-sm text-destructive">
                    {words[state.error]}
                  </p>
                ) : null}
              </div>
              <Button type="submit" disabled={pending || !kind}>
                <CalendarClock className="size-4" aria-hidden />
                {words.create}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
      <div className="grid gap-3">
        {jobs.length === 0 ? (
          <Card>
            <CardContent className="p-6 text-sm text-muted-foreground">{words.empty}</CardContent>
          </Card>
        ) : null}
        {jobs.map((job) => (
          <Card key={job.id}>
            <CardContent className="grid gap-3 p-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium">{job.name}</p>
                  <Badge variant={job.enabled ? "default" : "outline"}>
                    {job.enabled ? words.active : words.paused}
                  </Badge>
                  <code className="text-xs text-muted-foreground" dir="ltr">
                    {job.kind}
                  </code>
                </div>
                <code className="mt-2 block break-all text-xs text-muted-foreground" dir="ltr">
                  {job.schedule} · {job.timezone}
                </code>
                <dl className="mt-3 grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
                  <div>
                    <dt>{words.nextRun}</dt>
                    <dd className="font-medium text-foreground">{job.nextRunAt ?? words.never}</dd>
                  </div>
                  <div>
                    <dt>{words.lastRun}</dt>
                    <dd className="font-medium text-foreground">{job.lastRunAt ?? words.never}</dd>
                  </div>
                </dl>
              </div>
              <div className="flex flex-wrap gap-2">
                <form action={setScheduledJobEnabledAction}>
                  <input type="hidden" name="id" value={job.id} />
                  <input type="hidden" name="version" value={job.version} />
                  <input type="hidden" name="enabled" value={job.enabled ? "false" : "true"} />
                  <Button type="submit" size="sm" variant="outline">
                    {job.enabled ? (
                      <Pause className="size-4" aria-hidden />
                    ) : (
                      <Play className="size-4" aria-hidden />
                    )}
                    {job.enabled ? words.pause : words.resume}
                  </Button>
                </form>
                <form action={retireScheduledJobAction}>
                  <input type="hidden" name="id" value={job.id} />
                  <input type="hidden" name="version" value={job.version} />
                  <Button type="submit" size="sm" variant="destructive">
                    <Trash2 className="size-4" aria-hidden />
                    {words.retire}
                  </Button>
                </form>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
