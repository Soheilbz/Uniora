"use client";

import { Check, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ParticipantImportPreview } from "@/modules/settings/import-model.ts";

type ImportStage =
  | "file"
  | "map"
  | "validate"
  | "match"
  | "resolve"
  | "preview"
  | "import"
  | "result";

export function ParticipantImportControls({
  stage,
  stageIndex,
  pending,
  canContinue,
  preview,
  labels,
  onBack,
  onNext,
  onCommit,
  onReset,
}: {
  stage: ImportStage;
  stageIndex: number;
  pending: boolean;
  canContinue: boolean;
  preview: ParticipantImportPreview | null;
  labels: Record<string, string>;
  onBack: () => void;
  onNext: () => void;
  onCommit: () => void;
  onReset: () => void;
}) {
  return (
    <div className="flex flex-wrap justify-between gap-2">
      <Button
        type="button"
        variant="outline"
        disabled={pending || stage === "file" || stage === "import"}
        onClick={onBack}
      >
        <ChevronLeft className="size-4 rtl:rotate-180" aria-hidden />
        {labels.back}
      </Button>
      {stageIndex < 5 && (
        <Button type="button" disabled={pending || !canContinue} onClick={onNext}>
          {pending ? labels.reading : labels.next}
          <ChevronRight className="size-4 rtl:rotate-180" aria-hidden />
        </Button>
      )}
      {stage === "preview" && (
        <Button
          type="button"
          disabled={pending || !preview || preview.capacityOverflow > 0}
          onClick={onCommit}
        >
          <Check className="size-4" aria-hidden />
          {labels.confirmImport}
        </Button>
      )}
      {stage === "result" && (
        <Button type="button" variant="outline" onClick={onReset}>
          {labels.importAnother}
        </Button>
      )}
    </div>
  );
}
