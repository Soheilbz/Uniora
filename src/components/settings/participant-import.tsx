"use client";

import { Download, FileSpreadsheet, FileUp, TriangleAlert } from "lucide-react";
import { useMemo, useState, useTransition } from "react";
import { ParticipantImportControls } from "@/components/settings/participant-import-controls";
import { ParticipantImportProfileSelector } from "@/components/settings/participant-import-profile-selector";
import {
  ImportFact as Fact,
  ImportFaults as Faults,
  ImportReviewCard as ReviewCard,
} from "@/components/settings/participant-import-review";
import { SettingsCard } from "@/components/settings/setting-row";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { serializeCsvWithBom } from "@/lib/csv/safe-csv.ts";
import type { ActionResult } from "@/lib/register/action-result.ts";
import type { ImportReport } from "@/modules/settings/import.ts";
import type {
  ImportMappingProfileView,
  ParticipantImportConflictPolicy,
  ParticipantImportMapping,
  ParticipantImportPreview,
} from "@/modules/settings/import-model.ts";

type ImportTarget = { id: string; title: string; enrolled: number; when: string };
type FinalAction = (
  _previous: (ActionResult & { report?: ImportReport }) | null,
  form: FormData,
) => Promise<ActionResult & { report?: ImportReport }>;
type PreviewAction = (
  form: FormData,
) => Promise<{ ok: boolean; error?: string; preview?: ParticipantImportPreview }>;
type SaveProfileAction = (
  form: FormData,
) => Promise<{ ok: boolean; error?: string; profile?: ImportMappingProfileView }>;

const fields = ["studentNumber", "name", "affiliation", "attendance"] as const;
const stages = [
  "file",
  "map",
  "validate",
  "match",
  "resolve",
  "preview",
  "import",
  "result",
] as const;
type ImportStage = (typeof stages)[number];

function nextImportStage(stage: ImportStage): ImportStage {
  return stages[Math.min(stages.length - 1, stages.indexOf(stage) + 1)] ?? stage;
}

function previousImportStage(stage: ImportStage): ImportStage {
  return stages[Math.max(0, stages.indexOf(stage) - 1)] ?? stage;
}

export function ParticipantImport({
  action,
  previewAction,
  saveProfileAction,
  targets,
  profiles: initialProfiles,
  t,
  locale,
}: {
  action: FinalAction;
  previewAction: PreviewAction;
  saveProfileAction: SaveProfileAction;
  targets: ImportTarget[];
  profiles: ImportMappingProfileView[];
  t: Record<string, string>;
  locale: string;
}) {
  const [stage, setStage] = useState<ImportStage>("file");
  const stageIndex = stages.indexOf(stage);
  const [workshopId, setWorkshopId] = useState(targets[0]?.id ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [mapping, setMapping] = useState<ParticipantImportMapping>({});
  const [policy, setPolicy] = useState<ParticipantImportConflictPolicy>("skip");
  const [preview, setPreview] = useState<ParticipantImportPreview | null>(null);
  const [result, setResult] = useState<(ActionResult & { report?: ImportReport }) | null>(null);
  const [error, setError] = useState("");
  const [profileName, setProfileName] = useState("");
  const [profiles, setProfiles] = useState(initialProfiles);
  const [pending, startTransition] = useTransition();
  const format = useMemo(
    () => new Intl.NumberFormat(locale === "fa" ? "fa-IR" : "en-US"),
    [locale],
  );

  const makeForm = (includeMapping = true) => {
    const form = new FormData();
    form.set("workshopId", workshopId);
    if (file) form.set("file", file);
    if (includeMapping) form.set("mapping", JSON.stringify(mapping));
    form.set("conflictPolicy", policy);
    return form;
  };

  const runPreview = (nextStage: ImportStage = stage === "file" ? "map" : stage) => {
    if (!file || !workshopId) {
      setError(!file ? "required" : "unknownWorkshop");
      return;
    }
    setError("");
    startTransition(async () => {
      const response = await previewAction(makeForm(Object.keys(mapping).length > 0));
      if (!response.ok || !response.preview) {
        setError(response.error ?? "readFailed");
        return;
      }
      setPreview(response.preview);
      if (Object.keys(mapping).length === 0) setMapping(response.preview.mapping);
      setStage(nextStage);
    });
  };

  const applyProfile = (profileId: string) => {
    const profile = profiles.find((candidate) => candidate.id === profileId);
    if (!profile) return;
    if (!profile.valid) {
      setError("mappingInvalid");
      return;
    }
    setError("");
    setMapping(profile.mapping);
    setPolicy(profile.conflictPolicy);
    setProfileName(profile.name);
    setPreview(null);
  };

  const saveProfile = () => {
    if (!profileName.trim()) return;
    const form = new FormData();
    form.set("profileName", profileName.trim());
    form.set("mapping", JSON.stringify(mapping));
    form.set("conflictPolicy", policy);
    startTransition(async () => {
      const response = await saveProfileAction(form);
      if (!response.ok || !response.profile) {
        setError(response.error ?? "writeFailed");
        return;
      }
      const savedProfile = response.profile;
      setProfiles((current) =>
        [...current.filter((candidate) => candidate.id !== savedProfile.id), savedProfile].sort(
          (a, b) => a.name.localeCompare(b.name),
        ),
      );
      setError("");
    });
  };

  const commit = () => {
    if (!preview || !file) return;
    setStage("import");
    startTransition(async () => {
      const response = await action(null, makeForm());
      setResult(response);
      setStage("result");
    });
  };

  const downloadFaults = () => {
    const faults = result?.report?.faults ?? preview?.faults ?? [];
    if (faults.length === 0) return;
    const csv = serializeCsvWithBom([
      ["row", "reason", "detail"],
      ...faults.map((fault) => [fault.row, fault.reason, fault.detail]),
    ]);
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "participant-import-errors.csv";
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const canContinue =
    stage === "file"
      ? Boolean(file && workshopId)
      : stage === "map"
        ? Boolean(mapping.studentNumber || mapping.name)
        : stage === "resolve"
          ? Boolean(file && workshopId)
          : Boolean(preview);

  return (
    <div className="flex max-w-5xl flex-col gap-4">
      <ol className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-8" aria-label={t.steps}>
        {stages.map((stage, index) => (
          <li
            key={stage}
            className={`rounded-lg border px-2 py-2 text-xs ${index === stageIndex ? "border-primary bg-primary/5 font-semibold" : index < stageIndex ? "bg-muted/40" : "text-muted-foreground"}`}
          >
            <span className="me-1 numeric">{format.format(index + 1)}</span>
            {t[`stage.${stage}`] ?? stage}
          </li>
        ))}
      </ol>

      {stage === "file" && (
        <SettingsCard title={t.importTitle ?? ""} description={t.importSubtitle}>
          <div className="grid gap-4 py-2 md:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">{t.importTarget}</span>
              <select
                name="workshopId"
                value={workshopId}
                onChange={(event) => setWorkshopId(event.target.value)}
                className="h-10 rounded-md border bg-background px-2"
              >
                {targets.length === 0 && <option value="">{t.noWorkshops}</option>}
                {targets.map((target) => (
                  <option key={target.id} value={target.id}>
                    {target.title}
                    {target.when ? ` — ${target.when}` : ""}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex flex-col gap-1 text-sm">
              <span className="font-medium">{t.attachedFile}</span>
              <label
                id="participant-import-file-label"
                className="flex min-h-28 cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed bg-muted/20 p-4 text-center hover:bg-muted/40"
              >
                <FileSpreadsheet className="size-6" aria-hidden />
                <span className="font-medium">{file?.name ?? t.dropHere}</span>
                <span className="text-xs text-muted-foreground">{t.accepted}</span>
                <input
                  className="sr-only"
                  type="file"
                  aria-labelledby="participant-import-file-label"
                  accept=".csv,text/csv"
                  onChange={(event) => {
                    setFile(event.target.files?.[0] ?? null);
                    setPreview(null);
                    setResult(null);
                  }}
                />
              </label>
            </div>
          </div>
        </SettingsCard>
      )}

      {stage === "map" && (
        <SettingsCard title={t.mapTitle ?? ""} description={t.mapHint ?? ""}>
          <div className="flex flex-col gap-4 py-2">
            <ParticipantImportProfileSelector
              profiles={profiles}
              profileName={profileName}
              pending={pending}
              labels={{
                profile: t.profile ?? "profile",
                profileNone: t.profileNone ?? "none",
                profileName: t.profileName ?? "profile name",
                saveProfile: t.saveProfile ?? "save",
                mappingInvalid: t.mappingInvalid ?? "invalid mapping",
              }}
              onApply={applyProfile}
              onNameChange={setProfileName}
              onSave={saveProfile}
            />
            <div className="grid gap-3 sm:grid-cols-2">
              {fields.map((field) => (
                <label key={field} className="flex flex-col gap-1 text-sm">
                  <span className="font-medium">{t[`field.${field}`]}</span>
                  <select
                    className="h-9 rounded-md border bg-background px-2"
                    value={mapping[field] ?? ""}
                    onChange={(event) => {
                      setMapping((current) => ({
                        ...current,
                        [field]: event.target.value || undefined,
                      }));
                      setPreview(null);
                    }}
                  >
                    <option value="">{t.notMapped}</option>
                    {preview?.headers.map((header) => (
                      <option key={header} value={header}>
                        {header}
                      </option>
                    )) ?? []}
                  </select>
                </label>
              ))}
            </div>
            {!preview && <p className="text-xs text-muted-foreground">{t.previewForHeaders}</p>}
          </div>
        </SettingsCard>
      )}

      {stage === "validate" && preview && (
        <ReviewCard
          title={t.validateTitle ?? ""}
          hint={t.validateHint ?? ""}
          facts={[
            [t.countRead ?? "", preview.read],
            [t.validRows ?? "", preview.valid],
            [t.countFailed ?? "", preview.invalid],
          ]}
          format={format}
        >
          {preview.faults.length > 0 && <Faults faults={preview.faults} t={t} format={format} />}
        </ReviewCard>
      )}

      {stage === "match" && preview && (
        <ReviewCard
          title={t.matchTitle ?? ""}
          hint={t.matchHint ?? ""}
          facts={[
            [t.matchedStudents ?? "", preview.matchedStudents],
            [t.unmatchedStudents ?? "", preview.unmatchedStudentNumbers],
            [t.existingParticipants ?? "", preview.existingParticipants],
          ]}
          format={format}
        />
      )}

      {stage === "resolve" && preview && (
        <SettingsCard title={t.resolveTitle ?? ""} description={t.resolveHint ?? ""}>
          <div className="grid gap-3 py-2 sm:grid-cols-2">
            {(["skip", "update"] as const).map((choice) => (
              <label
                key={choice}
                className={`flex cursor-pointer gap-3 rounded-xl border p-4 ${policy === choice ? "border-primary bg-primary/5" : ""}`}
              >
                <input
                  type="radio"
                  checked={policy === choice}
                  onChange={() => {
                    setPolicy(choice);
                    setPreview(null);
                  }}
                />
                <span>
                  <strong className="block text-sm">{t[`policy.${choice}`]}</strong>
                  <span className="text-xs text-muted-foreground">{t[`policy.${choice}Hint`]}</span>
                </span>
              </label>
            ))}
          </div>
        </SettingsCard>
      )}

      {stage === "preview" && preview && (
        <ReviewCard
          title={t.previewTitle ?? ""}
          hint={t.previewHint ?? ""}
          facts={[
            [t.wouldCreate ?? "", preview.wouldCreate],
            [t.wouldUpdate ?? "", preview.wouldUpdate],
            [t.wouldSkip ?? "", preview.wouldSkip],
            [t.capacityOverflow ?? "", preview.capacityOverflow],
          ]}
          format={format}
        >
          <Table containerClassName="rounded-lg border" className="table-auto text-xs">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                {preview.headers.map((header) => (
                  <TableHead key={header} className="py-2 text-xs font-medium">
                    {header}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {preview.sample.map((row) => (
                <TableRow key={row.join("\u001f")}>
                  {preview.headers.map((header, index) => (
                    <TableCell key={header} className="max-w-56 truncate py-2">
                      {row[index] ?? ""}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </ReviewCard>
      )}

      {stage === "import" && (
        <SettingsCard title={t.importingTitle ?? ""} description={t.importingHint ?? ""}>
          <div className="flex min-h-32 items-center justify-center gap-3 text-sm text-muted-foreground">
            <FileUp className="size-5 animate-pulse" aria-hidden />
            {t.writing}
          </div>
        </SettingsCard>
      )}

      {stage === "result" && (
        <SettingsCard
          title={
            result?.ok
              ? (t.doneTitle ?? "")
              : (t.doneWithFaults ?? "").replace(
                  "{count}",
                  format.format(result?.report?.faults.length ?? 0),
                )
          }
          description={t.resultHint ?? ""}
        >
          {result?.report && (
            <div className="flex flex-col gap-4 py-2">
              <dl className="grid gap-3 sm:grid-cols-4">
                <Fact label={t.countRead ?? ""} value={result.report.read} format={format} />
                <Fact label={t.countCreated ?? ""} value={result.report.created} format={format} />
                <Fact label={t.countUpdated ?? ""} value={result.report.updated} format={format} />
                <Fact label={t.countSkipped ?? ""} value={result.report.skipped} format={format} />
              </dl>
              {result.report.faults.length > 0 && (
                <>
                  <Faults faults={result.report.faults} t={t} format={format} />
                  <Button type="button" variant="outline" onClick={downloadFaults}>
                    <Download className="size-4" aria-hidden />
                    {t.downloadFaults}
                  </Button>
                </>
              )}
            </div>
          )}
        </SettingsCard>
      )}

      {error && (
        <p
          role="alert"
          className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
        >
          <TriangleAlert className="me-2 inline size-4" aria-hidden />
          {t[error] ?? error}
        </p>
      )}

      <ParticipantImportControls
        stage={stage}
        stageIndex={stageIndex}
        pending={pending}
        canContinue={canContinue}
        preview={preview}
        labels={t}
        onBack={() => setStage((current) => previousImportStage(current))}
        onNext={() => {
          if (stage === "file") runPreview("map");
          else if (stage === "map" || !preview) runPreview(nextImportStage(stage));
          else setStage((current) => nextImportStage(current));
        }}
        onCommit={commit}
        onReset={() => {
          setStage("file");
          setFile(null);
          setPreview(null);
          setResult(null);
          setError("");
        }}
      />
    </div>
  );
}
