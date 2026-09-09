"use client";

import { Trash2 } from "lucide-react";
import { useActionState, useEffect, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { ActionResult } from "@/lib/register/action-result.ts";
import type { CalendarEntryDraft } from "@/modules/calendar/queries.ts";

/**
 * The editor for one of the office's own calendar entries.
 *
 * The whole of the calendar's writing surface. It closes itself on a successful
 * save and stays open on a refused one, holding what was typed — the ordinary
 * shape every form in this application uses, and the reason the action returns
 * `values`.
 */
export function CalendarEntryDialog({
  draft,
  onClose,
  save,
  remove,
  t,
}: {
  draft: CalendarEntryDraft;
  onClose: () => void;
  save: (previous: ActionResult | null, form: FormData) => Promise<ActionResult>;
  remove: (previous: ActionResult | null, form: FormData) => Promise<ActionResult>;
  t: Record<string, string>;
}) {
  const [result, submit, pending] = useActionState(save, null);
  const [removeResult, submitRemove, removing] = useActionState(remove, null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [, startTransition] = useTransition();

  /* Closed on success only. A refused save keeps the dialog and its values, so
     nobody retypes a note to correct one field. */
  useEffect(() => {
    if (result?.ok || removeResult?.ok) onClose();
  }, [result, removeResult, onClose]);

  const shown = result?.values ?? draft;
  const error = (field: string) =>
    result?.errors?.[field] ? (t[result.errors[field] ?? ""] ?? result.errors[field]) : null;

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent showCloseButton={false}>
        <form action={submit}>
          <input type="hidden" name="id" value={draft.id} />
          <input type="hidden" name="version" value={draft.version} />
          <input type="hidden" name="entryDate" value={draft.entryDate} />

          <DialogHeader>
            <DialogTitle>{draft.id === "" ? t.addEntry : t.editEntry}</DialogTitle>
            <DialogDescription className="numeric">{t.onDate}</DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-3 py-4">
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">{t.entryTitle}</span>
              <Input
                name="title"
                defaultValue={String(shown.title ?? "")}
                maxLength={200}
                required
                aria-invalid={error("title") ? true : undefined}
              />
              {error("title") && <span className="text-xs text-destructive">{error("title")}</span>}
            </label>

            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium">{t.startTime}</span>
                <Input
                  name="startTime"
                  defaultValue={String(shown.startTime ?? "")}
                  placeholder={t.timePlaceholder}
                  className="numeric"
                  inputMode="numeric"
                  aria-invalid={error("startTime") ? true : undefined}
                />
                {error("startTime") && (
                  <span className="text-xs text-destructive">{error("startTime")}</span>
                )}
              </label>

              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium">{t.endTime}</span>
                <Input
                  name="endTime"
                  defaultValue={String(shown.endTime ?? "")}
                  placeholder={t.timePlaceholder}
                  className="numeric"
                  inputMode="numeric"
                  aria-invalid={error("endTime") ? true : undefined}
                />
                {error("endTime") && (
                  <span className="text-xs text-destructive">{error("endTime")}</span>
                )}
              </label>
            </div>

            {/* Left empty means an entry that occupies the whole day, which is
                most of what an office calendar holds. */}
            <p className="text-xs text-muted-foreground">{t.allDayHint}</p>

            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">{t.notes}</span>
              <Textarea
                name="notes"
                defaultValue={String(shown.notes ?? "")}
                rows={3}
                maxLength={2000}
                aria-invalid={error("notes") ? true : undefined}
              />
              {error("notes") && <span className="text-xs text-destructive">{error("notes")}</span>}
            </label>

            {result?.message && !result.ok && (
              <p className="text-sm text-destructive" role="alert">
                {t[result.message] ?? result.message}
              </p>
            )}
            {removeResult?.message && !removeResult.ok && (
              <p className="text-sm text-destructive" role="alert">
                {t[removeResult.message] ?? removeResult.message}
              </p>
            )}
          </div>

          <DialogFooter className="sm:justify-between">
            {/*
             * Deleting sits apart from the other two, on the opposite side.
             *
             * It is the one control here whose effect cannot be undone, and
             * putting it beside «ذخیره» is how somebody deletes a note they
             * meant to save.
             */}
            {draft.id === "" ? (
              <span />
            ) : confirmingDelete ? (
              <span className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-destructive" role="alert">
                  {t.deleteConfirm}
                </span>
                <Button
                  type="button"
                  variant="destructive"
                  disabled={removing}
                  onClick={() => {
                    const form = new FormData();
                    form.set("id", draft.id);
                    form.set("version", String(draft.version));
                    startTransition(() => submitRemove(form));
                  }}
                >
                  <Trash2 className="size-4" aria-hidden />
                  {t.deleteEntry}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={removing}
                  onClick={() => setConfirmingDelete(false)}
                >
                  {t.cancel}
                </Button>
              </span>
            ) : (
              <Button
                type="button"
                variant="ghost"
                className="text-destructive hover:text-destructive"
                disabled={removing}
                onClick={() => setConfirmingDelete(true)}
              >
                <Trash2 className="size-4" aria-hidden />
                {t.deleteEntry}
              </Button>
            )}

            <span className="flex gap-2">
              <Button type="button" variant="outline" onClick={onClose}>
                {t.cancel}
              </Button>
              <Button type="submit" disabled={pending}>
                {t.save}
              </Button>
            </span>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
