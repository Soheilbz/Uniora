import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { LargeParticipantImport } from "@/components/settings/large-participant-import";
import { ParticipantImport } from "@/components/settings/participant-import";
import { requireCapability } from "@/lib/viewer.ts";
import { importParticipants } from "@/modules/settings/import.ts";
import {
  readImportTargets,
  readParticipantImportProfiles,
} from "@/modules/settings/import-queries.ts";
import {
  previewParticipantImport,
  saveParticipantImportProfile,
} from "@/modules/settings/import-wizard.ts";
import { listLargeImportBatches } from "@/modules/settings/large-import.ts";

export async function generateMetadata() {
  const t = await getTranslations("settings");
  return { title: t("nav.import") };
}

export default async function ImportPage() {
  const viewer = await requireCapability("workshops.manage");
  const [targets, profiles, batches, t, importWords, format, locale] = await Promise.all([
    readImportTargets(viewer.tenantId),
    readParticipantImportProfiles(viewer.tenantId),
    listLargeImportBatches(viewer.tenantId),
    getTranslations("settings"),
    getTranslations("importExport"),
    getFormatter(),
    getLocale(),
  ]);
  const words: Record<string, string> = {
    importTitle: importWords("importName"),
    importSubtitle: importWords("importSubtitle"),
    importWhat: importWords("importWhat"),
    attachedFile: importWords("attachedFile"),
    browse: importWords("browse"),
    apply: importWords("confirmApply"),
    doneTitle: importWords("doneTitle"),
    doneWithFaults: importWords("doneWithFaults", { count: "{count}" }),
    countRead: importWords("countRead"),
    countCreated: importWords("countCreated"),
    countSkipped: importWords("countSkipped"),
    countFailed: importWords("countFailed"),
    faultsHint: importWords("faultsHint"),
    faultsMore: importWords("faultsMore", { count: "{count}" }),
    faultRowColumn: importWords("faultRowColumn"),
    fileTooLarge: importWords("fileTooLarge", { name: "{name}" }),
    notCsv: importWords("notCsv"),
    malformedCsv: importWords("malformedCsv"),
    tooManyRows: importWords("tooManyRows"),
    columnsHint: t("data.importColumnsHint"),
    noWorkshops: t("data.noWorkshops"),
    noRows: t("data.noRows"),
    noKeyColumn: importWords("noKeyColumn"),
    required: t("error.required"),
    "fault.blank": importWords("faultBlank"),
    "fault.unknownStudent": t("data.faultUnknownStudent"),
    "fault.unknownWorkshop": t("data.faultUnknownWorkshop"),
    "fault.capacityFull": importWords("faultCapacityFull"),
    "fault.tooLong": importWords("faultTooLong"),
    "fault.unknownAttendance": importWords("faultUnknownAttendance"),
    "fault.unknownPayment": importWords("faultUnknownPayment"),
    importDone: importWords("doneTitle"),
    importDoneWithFaults: importWords("doneWithFaults", { count: "{count}" }),
    dropHere: importWords("dropHere"),
    accepted: importWords("accepted"),
    reading: importWords("reading"),
    writing: importWords("writing"),
    downloadFaults: importWords("downloadFaults"),
    importAnother: importWords("importAnother"),
    countUpdated: importWords("countUpdated"),
    back: importWords("wizardBack"),
    next: importWords("wizardNext"),
    importTarget: importWords("wizardTarget"),
    mapTitle: importWords("wizardMapTitle"),
    mapHint: importWords("wizardMapHint"),
    profile: importWords("wizardProfile"),
    profileNone: importWords("wizardProfileNone"),
    profileName: importWords("wizardProfileName"),
    saveProfile: importWords("wizardSaveProfile"),
    notMapped: importWords("wizardNotMapped"),
    previewForHeaders: importWords("wizardPreviewForHeaders"),
    validateTitle: importWords("wizardValidateTitle"),
    validateHint: importWords("wizardValidateHint"),
    validRows: importWords("wizardValidRows"),
    matchTitle: importWords("wizardMatchTitle"),
    matchHint: importWords("wizardMatchHint"),
    matchedStudents: importWords("wizardMatchedStudents"),
    unmatchedStudents: importWords("wizardUnmatchedStudents"),
    existingParticipants: importWords("wizardExistingParticipants"),
    resolveTitle: importWords("wizardResolveTitle"),
    resolveHint: importWords("wizardResolveHint"),
    "policy.skip": importWords("policySkip"),
    "policy.skipHint": importWords("policySkipHint", { count: "{count}" }),
    "policy.update": importWords("policyUpdate"),
    "policy.updateHint": importWords("policyUpdateHint"),
    previewTitle: importWords("wizardPreviewTitle"),
    previewHint: importWords("wizardPreviewHint"),
    wouldCreate: importWords("wizardWouldCreate"),
    wouldUpdate: importWords("wizardWouldUpdate"),
    wouldSkip: importWords("wizardWouldSkip"),
    capacityOverflow: importWords("wizardCapacityOverflow"),
    importingTitle: importWords("wizardImportingTitle"),
    importingHint: importWords("wizardImportingHint"),
    resultHint: importWords("wizardResultHint"),
    confirmImport: importWords("wizardConfirmImport"),
    profileNameInvalid: importWords("wizardProfileNameInvalid"),
    mappingInvalid: importWords("wizardMappingInvalid"),
    conflict: importWords("wizardConflict"),
    writeFailed: importWords("wizardWriteFailed"),
    "field.studentNumber": importWords("wizardStudentNumber"),
    "field.name": importWords("wizardName"),
    "field.affiliation": importWords("wizardAffiliation"),
    "field.attendance": importWords("wizardAttendance"),
    "stage.file": importWords("wizardStageFile"),
    "stage.map": importWords("wizardStageMap"),
    "stage.validate": importWords("wizardStageValidate"),
    "stage.match": importWords("wizardStageMatch"),
    "stage.resolve": importWords("wizardStageResolve"),
    "stage.preview": importWords("wizardStagePreview"),
    "stage.import": importWords("wizardStageImport"),
    "stage.result": importWords("wizardStageResult"),
  };

  const largeWords = {
    title: importWords("largeTitle"),
    description: importWords("largeDescription"),
    workshop: importWords("wizardTarget"),
    profile: importWords("wizardProfile"),
    autoMap: importWords("largeAutoMap"),
    conflict: importWords("wizardConflict"),
    skip: importWords("policySkip"),
    update: importWords("policyUpdate"),
    file: importWords("attachedFile"),
    upload: importWords("largeUpload"),
    refresh: importWords("largeRefresh"),
    cancel: importWords("largeCancel"),
    recent: importWords("largeRecent"),
    noBatches: importWords("largeNoBatches"),
    progress: importWords("largeProgress"),
    created: importWords("countCreated"),
    updated: importWords("countUpdated"),
    skipped: importWords("countSkipped"),
    faults: importWords("countFailed"),
    sizeHint: importWords("largeSizeHint"),
    queued: importWords("largeQueued"),
    running: importWords("largeRunning"),
    completed: importWords("largeCompleted"),
    failed: importWords("largeFailed"),
    uploading: importWords("largeUploading"),
    cancelled: importWords("largeCancelled"),
    expired: importWords("largeExpired"),
    uploadFailed: importWords("largeUploadFailed"),
  };

  return (
    <div className="grid gap-6">
      <ParticipantImport
        action={importParticipants}
        previewAction={previewParticipantImport}
        saveProfileAction={saveParticipantImportProfile}
        profiles={profiles}
        targets={targets.map((target) => ({
          id: target.id,
          title: target.title,
          enrolled: target.enrolled,
          when: target.workshopDate
            ? format.dateTime(new Date(target.workshopDate), { dateStyle: "medium" })
            : "",
        }))}
        t={words}
        locale={locale}
      />
      <LargeParticipantImport
        targets={targets.map((target) => ({ id: target.id, title: target.title }))}
        profiles={profiles
          .filter((profile) => profile.valid)
          .map((profile) => ({
            id: profile.id,
            name: profile.name,
            conflictPolicy: profile.conflictPolicy,
          }))}
        batches={batches.map((batch) => ({
          ...batch,
          createdAt: batch.createdAt.toISOString(),
          completedAt: batch.completedAt?.toISOString() ?? null,
          expiresAt: batch.expiresAt.toISOString(),
        }))}
        words={largeWords}
      />
    </div>
  );
}
