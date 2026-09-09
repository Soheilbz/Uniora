"use client";

import { FileUp, RefreshCw, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge.tsx";
import { Button } from "@/components/ui/button.tsx";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.tsx";
import {
  cancelLargeParticipantImportAction,
  completeLargeParticipantImportAction,
  prepareLargeParticipantImportAction,
} from "@/modules/settings/large-import-actions.ts";

interface Target {
  id: string;
  title: string;
}
interface Profile {
  id: string;
  name: string;
  conflictPolicy: "skip" | "update";
}
interface Batch {
  id: string;
  workshopId: string;
  filename: string;
  sizeBytes: number;
  status: string;
  processedRows: number;
  totalRows: number | null;
  createdCount: number;
  updatedCount: number;
  skippedCount: number;
  faultCount: number;
  publicError: string | null;
  createdAt: string;
  completedAt: string | null;
  expiresAt: string;
}
interface Words {
  title: string;
  description: string;
  workshop: string;
  profile: string;
  autoMap: string;
  conflict: string;
  skip: string;
  update: string;
  file: string;
  upload: string;
  refresh: string;
  cancel: string;
  recent: string;
  noBatches: string;
  progress: string;
  created: string;
  updated: string;
  skipped: string;
  faults: string;
  sizeHint: string;
  queued: string;
  running: string;
  completed: string;
  failed: string;
  uploading: string;
  cancelled: string;
  expired: string;
  uploadFailed: string;
}

export function LargeParticipantImport({
  targets,
  profiles,
  batches,
  words,
}: {
  targets: Target[];
  profiles: Profile[];
  batches: Batch[];
  words: Words;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [workshopId, setWorkshopId] = useState(targets[0]?.id ?? "");
  const [profileId, setProfileId] = useState("none");
  const [policy, setPolicy] = useState<"skip" | "update">("skip");
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const active = useMemo(
    () => batches.some((b) => ["uploading", "queued", "running"].includes(b.status)),
    [batches],
  );
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => router.refresh(), 5000);
    return () => window.clearInterval(timer);
  }, [active, router]);
  useEffect(() => {
    const profile = profiles.find((p) => p.id === profileId);
    if (profile) setPolicy(profile.conflictPolicy);
  }, [profileId, profiles]);

  async function upload() {
    if (!file || !workshopId) return;
    setError(null);
    startTransition(async () => {
      try {
        const prepared = await prepareLargeParticipantImportAction({
          workshopId,
          filename: file.name,
          sizeBytes: file.size,
          profileId: profileId === "none" ? null : profileId,
          conflictPolicy: policy,
        });
        const response = await fetch(prepared.uploadUrl, {
          method: "PUT",
          headers: { "Content-Type": "text/csv" },
          body: file,
        });
        if (!response.ok) throw new Error(`upload failed (${response.status})`);
        await completeLargeParticipantImportAction(prepared.batchId);
        setFile(null);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : words.uploadFailed);
      }
    });
  }

  function cancel(id: string) {
    startTransition(async () => {
      await cancelLargeParticipantImportAction(id);
      router.refresh();
    });
  }
  const statusWord = (status: string) =>
    (words as unknown as Record<string, string>)[status] ?? status;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <FileUp className="size-4" aria-hidden />
          {words.title}
        </CardTitle>
        <CardDescription>{words.description}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-5">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <div className="grid gap-1.5">
            <Label htmlFor="large-import-workshop">{words.workshop}</Label>
            <Select value={workshopId} onValueChange={(value) => setWorkshopId(value ?? "")}>
              <SelectTrigger id="large-import-workshop" aria-label={words.workshop}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {targets.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="large-import-profile">{words.profile}</Label>
            <Select value={profileId} onValueChange={(value) => setProfileId(value ?? "")}>
              <SelectTrigger id="large-import-profile" aria-label={words.profile}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{words.autoMap}</SelectItem>
                {profiles.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="large-import-conflict">{words.conflict}</Label>
            <Select value={policy} onValueChange={(v) => setPolicy(v as "skip" | "update")}>
              <SelectTrigger id="large-import-conflict" aria-label={words.conflict}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="skip">{words.skip}</SelectItem>
                <SelectItem value="update">{words.update}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label id="large-import-file-label" htmlFor="large-import-file">
              {words.file}
            </Label>
            <Input
              id="large-import-file"
              type="file"
              aria-labelledby="large-import-file-label"
              accept=".csv,text/csv"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
            <p className="text-xs text-muted-foreground">{words.sizeHint}</p>
          </div>
        </div>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <div className="flex flex-wrap gap-2">
          <Button onClick={upload} disabled={pending || !file || !workshopId}>
            {words.upload}
          </Button>
          <Button variant="outline" onClick={() => router.refresh()} disabled={pending}>
            <RefreshCw className="size-4" aria-hidden />
            {words.refresh}
          </Button>
        </div>
        <div>
          <p className="mb-2 text-sm font-medium">{words.recent}</p>
          {batches.length ? (
            <div className="grid gap-2">
              {batches.map((b) => {
                const total = b.totalRows ?? 0;
                const pct =
                  total > 0 ? Math.min(100, Math.round((b.processedRows / total) * 100)) : 0;
                return (
                  <div key={b.id} className="rounded-lg border p-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <strong className="truncate">{b.filename}</strong>
                          <Badge variant="outline">{statusWord(b.status)}</Badge>
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {words.created}: {b.createdCount} · {words.updated}: {b.updatedCount} ·{" "}
                          {words.skipped}: {b.skippedCount} · {words.faults}: {b.faultCount}
                        </p>
                        {b.publicError ? (
                          <p className="mt-1 text-xs text-destructive">{b.publicError}</p>
                        ) : null}
                      </div>
                      {["uploading", "queued"].includes(b.status) ? (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => cancel(b.id)}
                          disabled={pending}
                        >
                          <X className="size-4" aria-hidden />
                          {words.cancel}
                        </Button>
                      ) : null}
                    </div>
                    {["queued", "running", "completed"].includes(b.status) && total > 0 ? (
                      <div className="mt-3">
                        <div className="mb-1 flex justify-between text-xs text-muted-foreground">
                          <span>{words.progress}</span>
                          <span>
                            {b.processedRows}/{total} ({pct}%)
                          </span>
                        </div>
                        <div className="h-2 overflow-hidden rounded-full bg-muted">
                          <div
                            className="h-full bg-primary transition-[width]"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{words.noBatches}</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
