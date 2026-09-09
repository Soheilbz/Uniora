"use client";

import { UploadCloud } from "lucide-react";
import { useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import {
  completeManagedAttachment,
  prepareManagedAttachment,
} from "@/modules/documents/actions.ts";

export function AttachmentUploader({
  entityType,
  entityId,
  t,
}: {
  entityType: string;
  entityId: string;
  t: Record<string, string>;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [classification, setClassification] = useState("internal");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();

  const upload = () => {
    const file = inputRef.current?.files?.[0];
    if (!file) return;
    setError(null);
    setDone(false);
    startTransition(async () => {
      const prepared = await prepareManagedAttachment({
        entityType,
        entityId,
        filename: file.name,
        mimeType: file.type || "application/octet-stream",
        sizeBytes: file.size,
        classification,
      });
      if (!prepared.ok) {
        setError(t[prepared.error] ?? t.failed ?? prepared.error);
        return;
      }
      try {
        const response = await fetch(prepared.uploadUrl, {
          method: "PUT",
          body: file,
          ...(file.type ? { headers: { "content-type": file.type } } : {}),
        });
        if (!response.ok) throw new Error("upload failed");
        const completed = await completeManagedAttachment({
          entityType,
          entityId,
          attachmentId: prepared.attachmentId,
        });
        if (!completed.ok) throw new Error("completion failed");
        if (inputRef.current) inputRef.current.value = "";
        setDone(true);
        window.location.reload();
      } catch {
        setError(t.failed ?? "Upload failed");
      }
    });
  };

  return (
    <div className="grid gap-2 rounded-xl border border-dashed p-3">
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_12rem_auto] sm:items-end">
        <label className="grid gap-1 text-sm">
          <span>{t.file}</span>
          <Input
            ref={inputRef}
            type="file"
            accept="application/pdf,image/png,image/jpeg,text/plain,text/csv,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          />
        </label>
        <label className="grid gap-1 text-sm">
          <span>{t.classification}</span>
          <select
            value={classification}
            onChange={(event) => setClassification(event.target.value)}
            className="h-9 rounded-lg border border-input bg-background px-3 text-sm"
          >
            <option value="internal">{t.internal}</option>
            <option value="public">{t.public}</option>
            <option value="confidential">{t.confidential}</option>
            <option value="restricted">{t.restricted}</option>
          </select>
        </label>
        <Button type="button" onClick={upload} disabled={pending}>
          <UploadCloud className="size-4" aria-hidden />
          {pending ? t.uploading : t.upload}
        </Button>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {done ? (
        <p role="status" className="text-sm text-success-foreground">
          {t.done}
        </p>
      ) : null}
    </div>
  );
}
