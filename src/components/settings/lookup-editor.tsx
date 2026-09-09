"use client";

import { ChevronDown, ChevronUp, Pencil, Plus, RotateCcw, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Feedback } from "@/components/settings/profile-forms";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { ActionResult } from "@/lib/register/action-result.ts";
import type { LookupEntryView } from "@/modules/settings/lookup-queries.ts";

type Action = (previous: ActionResult | null, form: FormData) => Promise<ActionResult>;

/**
 * One vocabulary, as the office edits it.
 *
 * The order of the rows is the order somebody choosing from this list will read
 * — so it is editable here, in place, rather than being a number typed into a
 * field. Nudging a row up is the action; the position is the implementation.
 */
export function LookupEditor({
  set,
  entries,
  add,
  rename,
  retire,
  move,
  closed,
  required,
  t,
}: {
  set: string;
  entries: LookupEntryView[];
  add: Action;
  rename: Action;
  retire: Action;
  move: Action;
  /**
   * The software enumerates this set exhaustively, so nothing may be added.
   *
   * The add form is not disabled — it is not drawn at all, with a sentence in
   * its place saying why. A greyed-out form invites somebody to work out what
   * would re-enable it; the answer here is «nothing you can do», and that is
   * better said than implied.
   */
  closed: boolean;
  /** Values the software branches on, which cannot be withdrawn from the forms. */
  required: readonly string[];
  t: Record<string, string>;
}) {
  const [addResult, submitAdd, adding] = useActionState(add, null);
  const [renameResult, submitRename, renaming] = useActionState(rename, null);
  const [retireResult, submitRetire, retiring] = useActionState(retire, null);
  const [moveResult, submitMove, moving] = useActionState(move, null);
  const [, startTransition] = useTransition();
  const say = useTranslations();

  /** Which row is being renamed. One at a time — this is a correction, not a bulk edit. */
  const [editing, setEditing] = useState<string | null>(null);
  const addForm = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (renameResult?.ok) setEditing(null);
  }, [renameResult]);

  useEffect(() => {
    if (addResult?.ok) addForm.current?.reset();
  }, [addResult]);

  useEffect(() => {
    const failed = [retireResult, moveResult].find((result) => result && !result.ok);
    if (!failed) return;
    const key = failed.message;
    const message = key
      ? key.includes(".")
        ? say(key)
        : (t[key] ?? key)
      : (t.saveFailed ?? "Save failed");
    toast.error(message);
  }, [retireResult, moveResult, say, t]);

  const post = (action: (form: FormData) => void, fields: Record<string, string>) => {
    const form = new FormData();
    for (const [key, value] of Object.entries(fields)) form.set(key, value);
    startTransition(() => action(form));
  };

  const busy = adding || renaming || retiring || moving;

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t.label}</TableHead>
              <TableHead className="w-56">{t.value}</TableHead>
              <TableHead className="w-28">{t.status}</TableHead>
              <TableHead className="w-32" aria-label={t.sortOrder}>
                <span className="sr-only">{t.sortOrder}</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {entries.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="py-8 text-center text-sm text-muted-foreground">
                  {t.empty}
                </TableCell>
              </TableRow>
            )}

            {entries.map((entry, index) => (
              <TableRow key={entry.id} className={entry.retired ? "opacity-60" : undefined}>
                <TableCell>
                  {editing === entry.id ? (
                    <form action={submitRename} className="flex flex-wrap items-center gap-2">
                      <input type="hidden" name="id" value={entry.id} />
                      <Input
                        name="label"
                        defaultValue={entry.label}
                        maxLength={200}
                        autoFocus
                        aria-label={`${t.editValue} — ${entry.label}`}
                        className="h-8 max-w-sm text-xs font-semibold"
                      />
                      <Button type="submit" size="sm" className="h-8 px-3 text-xs" disabled={busy}>
                        {t.save}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-8 px-2 text-xs"
                        onClick={() => setEditing(null)}
                      >
                        {t.cancel}
                      </Button>
                    </form>
                  ) : (
                    <span className="text-xs font-bold text-foreground">{entry.label}</span>
                  )}
                </TableCell>

                <TableCell>
                  <span className="numeric text-xs font-mono text-muted-foreground" dir="ltr">
                    {entry.value}
                  </span>
                </TableCell>

                <TableCell>
                  <div className="flex flex-wrap items-center gap-1">
                    {entry.retired ? (
                      <Badge
                        variant="outline"
                        className="font-medium text-[10px] text-muted-foreground border-border/60"
                      >
                        {t.retired}
                      </Badge>
                    ) : (
                      <Badge
                        variant="outline"
                        className="ui-state-success font-semibold text-[10px]"
                      >
                        {t.offered}
                      </Badge>
                    )}
                    {required.includes(entry.value) && (
                      <Badge
                        variant="outline"
                        className="font-normal text-[10px] bg-primary/10 text-primary border-primary/30"
                      >
                        {t.valueRequiredBadge}
                      </Badge>
                    )}
                  </div>
                </TableCell>

                <TableCell>
                  <div className="flex items-center justify-end gap-1">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`${t.moveUp} — ${entry.label}`}
                      title={t.moveUp}
                      disabled={busy || index === 0}
                      onClick={() => post(submitMove, { id: entry.id, direction: "up" })}
                    >
                      <ChevronUp className="size-4" aria-hidden />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`${t.moveDown} — ${entry.label}`}
                      title={t.moveDown}
                      disabled={busy || index === entries.length - 1}
                      onClick={() => post(submitMove, { id: entry.id, direction: "down" })}
                    >
                      <ChevronDown className="size-4" aria-hidden />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`${t.editValue} — ${entry.label}`}
                      title={t.editValue}
                      disabled={busy}
                      onClick={() => setEditing(entry.id)}
                    >
                      <Pencil className="size-4" aria-hidden />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`${entry.retired ? t.restore : t.retire} — ${entry.label}`}
                      title={entry.retired ? t.restore : t.retire}
                      disabled={busy || (!entry.retired && required.includes(entry.value))}
                      onClick={() =>
                        post(submitRetire, { id: entry.id, retired: entry.retired ? "0" : "1" })
                      }
                    >
                      {entry.retired ? (
                        <RotateCcw className="size-4 text-success-subtle-foreground" aria-hidden />
                      ) : (
                        <X className="size-4 text-destructive" aria-hidden />
                      )}
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Feedback result={renameResult} t={t} />

      {closed ? (
        <div className="flex flex-col gap-1 rounded-xl border border-dashed bg-card p-4">
          <p className="text-sm font-semibold text-foreground">{t.codeOwned}</p>
          <p className="text-xs text-muted-foreground">{t.codeOwnedHint}</p>
        </div>
      ) : (
        <form
          ref={addForm}
          action={submitAdd}
          className="flex flex-col gap-3 rounded-xl border border-border/80 bg-card p-4 shadow-2xs"
        >
          <div>
            <p className="text-xs font-bold text-foreground">{t.addValue}</p>
            <p className="text-[11px] text-muted-foreground">{t.valueHint}</p>
          </div>
          <input type="hidden" name="set" value={set} />
          <div className="flex flex-wrap items-start gap-3">
            <div className="flex min-w-0 flex-1 basis-56 flex-col gap-1">
              <Input
                name="label"
                placeholder={t.label}
                maxLength={200}
                required
                className="w-full text-xs font-medium"
                aria-label={t.label ?? ""}
                aria-invalid={addResult?.errors?.label ? true : undefined}
              />
              {addResult?.errors?.label && (
                <span className="text-xs text-destructive">
                  {t[addResult.errors.label] ?? addResult.errors.label}
                </span>
              )}
            </div>
            <div className="flex min-w-0 flex-1 basis-56 flex-col gap-1">
              <Input
                name="value"
                placeholder={t.value}
                dir="ltr"
                maxLength={64}
                required
                className="w-full font-mono text-xs font-medium"
                aria-label={t.value ?? ""}
                aria-invalid={addResult?.errors?.value ? true : undefined}
              />
              {addResult?.errors?.value && (
                <span className="text-xs text-destructive">
                  {t[addResult.errors.value] ?? addResult.errors.value}
                </span>
              )}
            </div>
            <Button type="submit" disabled={busy} className="h-9 px-4 text-xs font-semibold">
              <Plus className="size-4" aria-hidden />
              {t.addValue}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
