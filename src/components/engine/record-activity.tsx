"use client";
import { Pin, PinOff } from "lucide-react";
import { useEffect, useState, useTransition } from "react";
import { Button } from "@/components/ui/button.tsx";
import { togglePinnedRecord, touchRecentRecord } from "@/modules/experience/actions.ts";
import type { QuickEntityType } from "@/modules/experience/records.ts";
export function RecordActivity({
  entityType,
  entityId,
  label,
  href,
  initialPinned,
  pinLabel,
  unpinLabel,
}: {
  entityType: QuickEntityType;
  entityId: string;
  label: string;
  href: string;
  initialPinned: boolean;
  pinLabel: string;
  unpinLabel: string;
}) {
  const [pinned, setPinned] = useState(initialPinned);
  const [pending, start] = useTransition();
  useEffect(() => {
    const form = new FormData();
    form.set("entityType", entityType);
    form.set("entityId", entityId);
    form.set("label", label);
    form.set("href", href);
    void touchRecentRecord(form);
  }, [entityType, entityId, label, href]);
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={pending}
      aria-pressed={pinned}
      onClick={() => {
        const next = !pinned;
        setPinned(next);
        const form = new FormData();
        form.set("entityType", entityType);
        form.set("entityId", entityId);
        form.set("label", label);
        form.set("href", href);
        form.set("pinned", String(next));
        start(() => void togglePinnedRecord(form));
      }}
    >
      {pinned ? <PinOff aria-hidden /> : <Pin aria-hidden />}
      {pinned ? unpinLabel : pinLabel}
    </Button>
  );
}
