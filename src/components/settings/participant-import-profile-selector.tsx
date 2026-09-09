"use client";

import { Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ImportMappingProfileView } from "@/modules/settings/import-model.ts";

export function ParticipantImportProfileSelector({
  profiles,
  profileName,
  pending,
  labels,
  onApply,
  onNameChange,
  onSave,
}: {
  profiles: ImportMappingProfileView[];
  profileName: string;
  pending: boolean;
  labels: {
    profile: string;
    profileNone: string;
    profileName: string;
    saveProfile: string;
    mappingInvalid: string;
  };
  onApply: (profileId: string) => void;
  onNameChange: (name: string) => void;
  onSave: () => void;
}) {
  return (
    <div className="flex flex-wrap items-end gap-2">
      <label className="flex min-w-52 flex-col gap-1 text-xs">
        <span>{labels.profile}</span>
        <select
          className="h-9 rounded-md border bg-background px-2"
          defaultValue=""
          onChange={(event) => onApply(event.target.value)}
        >
          <option value="">{labels.profileNone}</option>
          {profiles.map((profile) => (
            <option key={profile.id} value={profile.id} disabled={!profile.valid}>
              {profile.name}
              {profile.valid ? "" : ` — ${labels.mappingInvalid}`}
            </option>
          ))}
        </select>
      </label>
      <label className="flex min-w-52 flex-col gap-1 text-xs">
        <span>{labels.profileName}</span>
        <input
          className="h-9 rounded-md border bg-background px-2"
          value={profileName}
          onChange={(event) => onNameChange(event.target.value)}
        />
      </label>
      <Button
        type="button"
        variant="outline"
        onClick={onSave}
        disabled={pending || !profileName.trim()}
      >
        <Save className="size-4" aria-hidden />
        {labels.saveProfile}
      </Button>
    </div>
  );
}
