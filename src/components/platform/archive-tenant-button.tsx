"use client";

import { useState } from "react";
import { PendingSubmitButton } from "@/components/pending-submit-button";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { requestTenantLifecycle } from "@/modules/platform/actions";

export function ArchiveTenantButton({
  slug,
  requestId,
  labels,
}: {
  slug: string;
  requestId: string;
  labels: {
    archive: string;
    title: string;
    description: string;
    instruction: string;
    confirmationLabel: string;
    cancel: string;
    submitting: string;
  };
}) {
  const expected = `ARCHIVE:${slug}`;
  const [confirmation, setConfirmation] = useState("");
  const confirmed = confirmation === expected;

  return (
    <Dialog>
      <DialogTrigger render={<Button type="button" size="xs" variant="destructive" />}>
        {labels.archive}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{labels.title}</DialogTitle>
          <DialogDescription>{labels.description}</DialogDescription>
        </DialogHeader>
        <form action={requestTenantLifecycle} className="grid gap-4">
          <input type="hidden" name="requestId" value={requestId} />
          <input type="hidden" name="slug" value={slug} />
          <input type="hidden" name="action" value="tenant.archive" />
          <label className="grid gap-2 text-sm">
            <span className="font-medium">{labels.instruction}</span>
            <code
              dir="ltr"
              className="w-fit rounded-md border bg-muted px-2 py-1 text-xs text-foreground"
            >
              {expected}
            </code>
            <input
              name="confirmation"
              value={confirmation}
              onChange={(event) => setConfirmation(event.currentTarget.value)}
              aria-label={labels.confirmationLabel}
              autoComplete="off"
              spellCheck={false}
              dir="ltr"
              className="h-9 rounded-lg border bg-transparent px-3 outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
            />
          </label>
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" />}>
              {labels.cancel}
            </DialogClose>
            <PendingSubmitButton
              size="sm"
              variant="destructive"
              disabled={!confirmed}
              pendingChildren={labels.submitting}
            >
              {labels.archive}
            </PendingSubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
