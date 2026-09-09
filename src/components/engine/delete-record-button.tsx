"use client";

import { Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { ActionResult } from "@/lib/register/action-result.ts";

/**
 * Retiring a record, behind a confirmation.
 *
 * The confirmation is not ceremony. This control is one button away from the
 * save button on a long form, and the two do opposite things — the dialog is
 * what stops a mis-aimed click from removing a person from the register.
 *
 * The dialog's own confirm is a form posting to the Server Action, so the delete
 * is a real submission with a real pending state, and the action re-checks the
 * capability. A dialog is a presentation detail; it is not what makes this safe.
 */
export function DeleteRecordButton({
  action,
  recordId,
  recordVersion,
  title,
  body,
  confirmLabel,
  cancelLabel,
  triggerLabel,
  refusals,
}: {
  action: (previous: ActionResult | null, form: FormData) => Promise<ActionResult>;
  recordId: string;
  recordVersion: number;
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel: string;
  triggerLabel: string;
  /**
   * The refusals this delete can give, already worded.
   *
   * A map rather than a function: a function cannot cross from a Server
   * Component into a client one at all — React refuses it — and the set of
   * refusals a given delete can produce is small and known when the page
   * renders. A key with no entry falls back to itself, which is a fragment of
   * source on screen and therefore something to fix rather than to hide.
   */
  refusals?: Record<string, string>;
}) {
  const [open, setOpen] = useState(false);
  const [result, submit, pending] = useActionState(action, null);
  const say = useTranslations();

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <Trash2 className="size-4" aria-hidden />
        {triggerLabel}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        {/*
         * No corner «×».
         *
         * The vendored `DialogContent` hard-codes its close button's accessible
         * name as the English string "Close", with no prop to override it and no
         * point editing the file — `shadcn add` overwrites `components/ui`. So a
         * Persian interface was announcing one control in English.
         *
         * Dropping it costs nothing here: this dialog already has an explicit
         * «انصراف», and Escape still dismisses it. A confirmation with two ways
         * to say no and one to say yes does not need a third.
         */}
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            {/*
             * The description says what actually happens — the record leaves the
             * register and its council history stays attached — because
             * "are you sure?" tells somebody nothing they can use to decide.
             */}
            <DialogDescription>{body}</DialogDescription>
          </DialogHeader>

          {/*
           * A refusal, said rather than swallowed.
           *
           * Not every delete succeeds: a professor still holding a supervision
           * seat is not retired, and the action returns a reason. This component
           * discarded that result, so pressing «حذف» on such a record closed
           * nothing, changed nothing and said nothing — indistinguishable from
           * a button that does not work.
           */}
          {result && !result.ok && result.message && (
            <p role="alert" className="text-sm text-destructive">
              {refusals?.[result.message] ?? say(result.message)}
            </p>
          )}
          <DialogFooter>
            <form action={submit}>
              <input type="hidden" name="id" value={recordId} />
              <input type="hidden" name="version" value={recordVersion} />
              <Button type="submit" variant="destructive" disabled={pending}>
                {confirmLabel}
              </Button>
            </form>
            {/*
             * Cancel is second in the markup and therefore second in the tab
             * order, so the key that dismisses this dialog is Escape and the
             * first thing focus lands on is not the destructive action.
             */}
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
              {cancelLabel}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
