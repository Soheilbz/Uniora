"use client";

import { FileUp, TriangleAlert } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useRef, useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
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
import { Spinner } from "@/components/ui/spinner";
import type { ImportFault, ImportPlan } from "@/lib/register/import.ts";
import type { ImportOutcome, RollbackOutcome } from "@/lib/register/import-write.ts";
import { ToolbarButton } from "./toolbar";

/**
 * Reading a spreadsheet into the register, in three named stages.
 *
 * ── Why the middle stage exists ─────────────────────────────────────────────
 *
 * An office importing a year's intake is holding a file somebody else prepared,
 * and «what will this do» has to be answerable before anything is written. A
 * dialog that offers only «Import» and then reports the damage is one that asks
 * somebody to find out by doing it — and on a register of two thousand people, a
 * file that silently overwrites four hundred records is not recoverable by
 * anybody sitting at this screen.
 *
 * So: choose a file, read what it *would* do, then agree to it. The refusals are
 * on screen at the review stage and stay on screen after the write, because a
 * file is usually part right and the reader has to fix the rest.
 *
 * ── Why the file is read here and posted as text ────────────────────────────
 *
 * The two Server Actions take a string. A `File` would have to cross as
 * `FormData`, which works, but then the plan and the write receive different
 * things depending on how each was called — and the parsing rules are the one
 * part of an import that must not vary between the preview and the write.
 */

const FAULTS_SHOWN = 15;

export function ImportDialog({
  plan,
  apply,
  rollback,
  maxBytes,
  limit,
}: {
  plan: (text: string) => Promise<ImportPlan>;
  apply: (text: string) => Promise<ImportOutcome>;
  rollback?: (batchId: string) => Promise<RollbackOutcome>;
  maxBytes: number;
  limit: number;
}) {
  const t = useTranslations("importing");
  const common = useTranslations("common");
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const requestToken = useRef(0);

  const [text, setText] = useState<string | null>(null);
  const [preview, setPreview] = useState<ImportPlan | null>(null);
  const [outcome, setOutcome] = useState<ImportOutcome | null>(null);
  const [rolledBack, setRolledBack] = useState<RollbackOutcome | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);

  const reset = () => {
    requestToken.current += 1;
    setText(null);
    setPreview(null);
    setOutcome(null);
    setRolledBack(null);
    setRefusal(null);
  };

  const choose = async (file: File | undefined) => {
    reset();
    const token = requestToken.current;
    if (!file) return;

    /*
     * Both checks before the file is read, not after. A refusal that arrives
     * once the browser has already loaded ten megabytes into memory is a
     * refusal that cost what it was meant to prevent.
     */
    if (file.size > maxBytes) {
      setRefusal(t("tooLarge"));
      return;
    }
    if (!/\.csv$/i.test(file.name)) {
      setRefusal(t("notCsv"));
      return;
    }

    try {
      const contents = await file.text();
      if (token !== requestToken.current) return;
      setText(contents);
      startTransition(async () => {
        try {
          const nextPreview = await plan(contents);
          if (token === requestToken.current) setPreview(nextPreview);
        } catch {
          if (token === requestToken.current) setRefusal(t("actionFailed"));
        }
      });
    } catch {
      if (token === requestToken.current) setRefusal(t("readFailed"));
    }
  };

  const faults = outcome?.faults ?? preview?.faults ?? [];
  const willWrite = (preview?.creates.length ?? 0) + (preview?.updates.length ?? 0);

  return (
    <div className="inline-flex">
      <ToolbarButton
        icon={<FileUp className="size-4" aria-hidden />}
        onClick={() => {
          reset();
          setOpen(true);
        }}
      >
        {t("action")}
      </ToolbarButton>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) reset();
        }}
      >
        <DialogContent showCloseButton={false} className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t("title")}</DialogTitle>
            <DialogDescription>{t("hint")}</DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4">
            {/* Stage one. Left in place after a file is chosen, so a reader who
                picked the wrong one can pick another without closing. */}
            <Input
              type="file"
              accept=".csv,text/csv"
              aria-label={t("pick")}
              disabled={pending}
              onChange={(event) => void choose(event.currentTarget.files?.[0])}
            />

            {refusal && (
              <p className="flex items-center gap-2 text-sm text-destructive" role="alert">
                <TriangleAlert className="size-4 shrink-0" aria-hidden />
                {refusal}
              </p>
            )}

            {pending && !preview && (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Spinner className="size-4" />
                {common("loading")}
              </p>
            )}

            {/* Stage two: what the file would do. Three figures, because those
                are the three questions — how many arrive, how many are
                overwritten, how many cannot be written at all. */}
            {preview && !outcome && (
              <Figures
                creates={preview.creates.length}
                updates={preview.updates.length}
                refused={preview.faults.length}
                words={{
                  creates: t("creates"),
                  updates: t("updates"),
                  refused: t("refused"),
                }}
              />
            )}

            {/* Stage three: what it did. */}
            {outcome && (
              <>
                <Figures
                  creates={outcome.created}
                  updates={outcome.updated}
                  refused={outcome.faults.length}
                  words={{
                    creates: t("creates"),
                    updates: t("updates"),
                    refused: t("refused"),
                  }}
                />
                <p className="text-sm" role="status">
                  {t("done", { created: outcome.created, updated: outcome.updated })}
                </p>
              </>
            )}

            {rolledBack && (
              <p
                className="rounded-lg border border-success/30 bg-success/8 p-3 text-sm"
                role="status"
              >
                {rolledBack.skipped > 0
                  ? t("rollbackPartial", {
                      count: rolledBack.rolledBack,
                      skipped: rolledBack.skipped,
                    })
                  : t("rolledBack", { count: rolledBack.rolledBack })}
              </p>
            )}

            {preview?.ignored.length ? (
              /*
               * The columns the register has nowhere to put, named.
               *
               * This is the commonest way an import «works» and loses data: the
               * file carried a column, the register does not have it, and
               * nothing said so.
               */
              <div className="flex flex-col gap-1.5 rounded-lg border border-dashed p-3">
                <p className="text-sm font-medium">{t("ignored")}</p>
                <p className="text-xs text-muted-foreground">{t("ignoredHint")}</p>
                <div className="flex flex-wrap gap-1.5">
                  {preview.ignored.map((column) => (
                    <Badge key={column} variant="outline" className="font-normal">
                      {column}
                    </Badge>
                  ))}
                </div>
              </div>
            ) : null}

            {preview && willWrite === 0 && faults.length === 0 && (
              <p className="text-sm text-muted-foreground">{t("nothing")}</p>
            )}

            {preview?.truncated && (
              <p className="text-sm text-muted-foreground">
                {t("capped", { limit, total: preview.totalRows })}
              </p>
            )}

            {faults.length > 0 && (
              <Faults
                faults={faults}
                lineLabel={(line) => t("line", { line })}
                shownLabel={t("faultsShown", {
                  shown: Math.min(FAULTS_SHOWN, faults.length),
                  total: faults.length,
                })}
              />
            )}
          </div>

          <DialogFooter>
            {/* Offered only once there is something to write, and gone once it
                has been written — the dialog's last state is a report. */}
            {preview && !outcome && willWrite > 0 && (
              <Button
                disabled={pending || !text || preview.truncated}
                onClick={() => {
                  if (!text) return;
                  setRefusal(null);
                  startTransition(async () => {
                    try {
                      setOutcome(await apply(text));
                    } catch {
                      setRefusal(t("actionFailed"));
                    }
                  });
                }}
              >
                {pending ? (
                  <>
                    <Spinner />
                    {t("applying")}
                  </>
                ) : (
                  t("apply")
                )}
              </Button>
            )}
            {outcome && rollback && !rolledBack && (
              <Button
                variant="outline"
                disabled={pending}
                onClick={() => {
                  setRefusal(null);
                  startTransition(async () => {
                    try {
                      setRolledBack(await rollback(outcome.batchId));
                    } catch {
                      setRefusal(t("actionFailed"));
                    }
                  });
                }}
              >
                {pending ? <Spinner /> : null}
                {t("rollback")}
              </Button>
            )}
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
              {outcome ? common("close") : common("cancel")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** The three figures, in the order the questions are asked. */
function Figures({
  creates,
  updates,
  refused,
  words,
}: {
  creates: number;
  updates: number;
  refused: number;
  words: { creates: string; updates: string; refused: string };
}) {
  /* In the reader's numerals, like the counts in the fault list underneath —
     which were Persian while these three were raw. */
  const format = useFormatter();
  const entries = [
    { value: creates, label: words.creates, tone: "" },
    { value: updates, label: words.updates, tone: "" },
    { value: refused, label: words.refused, tone: refused > 0 ? "text-destructive" : "" },
  ];

  return (
    <div className="grid grid-cols-3 gap-2">
      {entries.map((entry) => (
        <div key={entry.label} className="rounded-lg border p-3">
          <p className={`numeric text-xl font-medium ${entry.tone}`}>
            {format.number(entry.value)}
          </p>
          <p className="text-xs text-muted-foreground">{entry.label}</p>
        </div>
      ))}
    </div>
  );
}

/**
 * The lines that could not be written, named one by one.
 *
 * The first fifteen, because a file that is wholly wrong produces one fault per
 * line and a dialog listing four hundred of them is a dialog nobody reads. The
 * count of the rest is stated rather than implied.
 */
function Faults({
  faults,
  lineLabel,
  shownLabel,
}: {
  faults: ImportFault[];
  lineLabel: (line: number) => string;
  shownLabel: string;
}) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-medium text-destructive">{shownLabel}</p>
      <ul className="flex flex-col gap-1.5">
        {faults.slice(0, FAULTS_SHOWN).map((fault) => (
          <li
            key={`${fault.line}-${fault.column}-${fault.value}`}
            className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 rounded-md border border-destructive/30 bg-destructive/5 px-2.5 py-1.5 text-xs"
          >
            <span className="numeric font-medium">{lineLabel(fault.line)}</span>
            <span className="text-muted-foreground">{fault.column}</span>
            <span>{fault.reason}</span>
            {fault.value && <span className="text-muted-foreground">«{fault.value}»</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}
