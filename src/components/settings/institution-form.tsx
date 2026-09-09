"use client";

import { type Building2, Globe, Mail, MapPin, Phone, Upload } from "lucide-react";
import { type ComponentProps, useActionState, useState } from "react";
import { Feedback } from "@/components/settings/profile-forms";
import { SettingRow, SettingsCard } from "@/components/settings/setting-row";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ActionResult } from "@/lib/register/action-result.ts";
import { cn } from "@/lib/utils";
import type { InstitutionView } from "@/modules/settings/institution-queries.ts";

const FIELD_ICONS: Record<string, typeof Building2> = {
  address: MapPin,
  phone: Phone,
  email: Mail,
  website: Globe,
};

export function InstitutionForm({
  action,
  institution,
  t,
}: {
  action: (previous: ActionResult | null, form: FormData) => Promise<ActionResult>;
  institution: InstitutionView;
  t: Record<string, string>;
}) {
  const [result, submit, pending] = useActionState(action, null);
  const shown = result?.values ?? institution;

  const [preview, setPreview] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const showing = removing ? null : (preview ?? (institution.crest || null));

  const handleFile = (file?: File) => {
    if (!file) return;
    setRemoving(false);
    const reader = new FileReader();
    reader.onload = () => setPreview(String(reader.result));
    reader.readAsDataURL(file);
  };

  const field = (name: keyof InstitutionView, dir?: "ltr", isEn = false) => {
    const Icon = FIELD_ICONS[name];
    return (
      <SettingRow
        label={t[name] ?? name}
        htmlFor={`institution-${name}`}
        fluidControl
        control={
          <div className="flex w-full flex-col items-end gap-1">
            <div className="relative w-full max-w-[42rem]">
              {Icon && (
                <Icon className="pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground/70" />
              )}
              <Input
                id={`institution-${name}`}
                name={name}
                defaultValue={String(shown[name] ?? "")}
                maxLength={300}
                dir={dir}
                className={cn(
                  "w-full text-xs font-medium",
                  Icon && "ps-8.5",
                  isEn && "font-mono font-bold tracking-tight text-foreground",
                )}
                aria-invalid={result?.errors?.[name] ? true : undefined}
              />
            </div>
            {result?.errors?.[name] && (
              <span className="text-xs font-medium text-destructive">
                {t[result.errors[name] ?? ""] ?? result.errors[name]}
              </span>
            )}
          </div>
        }
      />
    );
  };

  return (
    <form action={submit} className="flex flex-col gap-5">
      <input type="hidden" name="version" value={institution.version} />
      {removing && <input type="hidden" name="removeCrest" value="1" />}

      <div className="grid gap-5 xl:grid-cols-2 xl:items-start">
        {/* Card 1: Identity & Crest */}
        <SettingsCard title={t.title ?? ""} description={t.subtitle}>
          {field("name")}
          {field("nameEn", "ltr", true)}
          {field("faculty")}

          <SettingRow
            stacked
            label={t.crest ?? ""}
            hint={t.crestHint}
            control={
              <div className="flex w-full flex-wrap items-center gap-3 pt-1">
                {/* Drag and drop image dropzone */}
                {/* biome-ignore lint/a11y/noStaticElementInteractions: drag-and-drop container for logo preview */}
                <div
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragOver(true);
                  }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragOver(false);
                    const file = e.dataTransfer.files?.[0];
                    handleFile(file);
                  }}
                  className={cn(
                    "flex size-24 shrink-0 items-center justify-center rounded-2xl border-2 bg-white p-2 shadow-2xs transition-all",
                    dragOver ? "border-primary border-dashed bg-primary/5" : "border-border/80",
                  )}
                >
                  {showing ? (
                    // biome-ignore lint/performance/noImgElement: a data URI has no remote origin to optimise and next/image cannot size one
                    <img src={showing} alt="" className="max-h-full max-w-full object-contain" />
                  ) : (
                    <span className="text-center text-[0.65rem] font-medium leading-tight text-muted-foreground">
                      {t.crestNone}
                    </span>
                  )}
                </div>

                <div className="flex flex-col gap-2">
                  <label className="inline-flex w-fit cursor-pointer items-center gap-2 rounded-lg border border-border/80 bg-background px-3 py-1.5 text-xs font-semibold hover:bg-accent transition-colors shadow-2xs">
                    <Upload className="size-3.5" aria-hidden />
                    {t.crest}
                    <input
                      type="file"
                      name="crest"
                      aria-label={t.crest}
                      accept="image/png,image/jpeg"
                      className="sr-only"
                      onChange={(event) => handleFile(event.target.files?.[0])}
                    />
                  </label>

                  {showing && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="w-fit h-7 text-xs text-destructive hover:bg-destructive/10 hover:border-destructive/30"
                      onClick={() => {
                        setPreview(null);
                        setRemoving(true);
                      }}
                    >
                      {t.crestRemove}
                    </Button>
                  )}

                  {result?.errors?.crest && (
                    <span className="text-xs text-destructive">
                      {t[result.errors.crest] ?? result.errors.crest}
                    </span>
                  )}
                </div>
              </div>
            }
          />
        </SettingsCard>

        {/* Card 2: Contact Details */}
        <SettingsCard
          title={t.contactTitle ?? ""}
          description={t.contactSubtitle ?? ""}
          actions={
            <Button type="submit" disabled={pending} className="px-5 font-semibold">
              {t.save}
            </Button>
          }
        >
          {field("address")}
          {field("phone", "ltr")}
          {field("email", "ltr")}
          {field("website", "ltr")}
        </SettingsCard>
      </div>

      <SettingsCard title={t.systemTitle ?? ""} description={t.systemSubtitle}>
        <OperationalSetting
          id="institution-timezone"
          name="timezone"
          label={t.timezone ?? ""}
          value={String(shown.timezone ?? "Asia/Tehran")}
          error={result?.errors?.timezone}
          t={t}
          inputProps={{ required: true, dir: "ltr" }}
        />
        <SettingRow
          label={t.locale ?? ""}
          htmlFor="institution-locale"
          fluidControl
          control={
            <div className="flex w-full flex-col gap-1">
              <select
                id="institution-locale"
                name="locale"
                defaultValue={String(shown.locale ?? "fa")}
                aria-invalid={result?.errors?.locale ? true : undefined}
                aria-describedby={result?.errors?.locale ? "institution-locale-error" : undefined}
                className="h-9 w-full rounded-md border bg-background px-3 text-sm"
              >
                <option value="fa">{t.localeFa}</option>
                <option value="en">{t.localeEn}</option>
              </select>
              <FieldError id="institution-locale-error" error={result?.errors?.locale} t={t} />
            </div>
          }
        />
        <SettingRow
          label={t.calendarSystem ?? ""}
          htmlFor="institution-calendar-system"
          fluidControl
          control={
            <div className="flex w-full flex-col gap-1">
              <select
                id="institution-calendar-system"
                name="calendarSystem"
                defaultValue={String(shown.calendarSystem ?? "jalali")}
                aria-invalid={result?.errors?.calendarSystem ? true : undefined}
                aria-describedby={
                  result?.errors?.calendarSystem ? "institution-calendar-system-error" : undefined
                }
                className="h-9 w-full rounded-md border bg-background px-3 text-sm"
              >
                <option value="jalali">{t.calendarJalali}</option>
                <option value="gregorian">{t.calendarGregorian}</option>
              </select>
              <FieldError
                id="institution-calendar-system-error"
                error={result?.errors?.calendarSystem}
                t={t}
              />
            </div>
          }
        />
        <OperationalSetting
          id="institution-session-hours"
          name="sessionHours"
          label={t.sessionHours ?? ""}
          value={String(shown.sessionHours ?? 8)}
          error={result?.errors?.sessionHours}
          t={t}
          inputProps={{ type: "number", min: 1, max: 24, required: true }}
        />
        <OperationalSetting
          id="institution-password-min-length"
          name="passwordMinLength"
          label={t.passwordMinLength ?? ""}
          value={String(shown.passwordMinLength ?? 12)}
          error={result?.errors?.passwordMinLength}
          t={t}
          inputProps={{ type: "number", min: 12, max: 64, required: true }}
        />
      </SettingsCard>

      <Feedback result={result} t={t} />
    </form>
  );
}
function FieldError({
  id,
  error,
  t,
}: {
  id: string;
  error: string | undefined;
  t: Record<string, string>;
}) {
  if (!error) return null;
  return (
    <span id={id} className="text-xs font-medium text-destructive" role="alert">
      {t[error] ?? error}
    </span>
  );
}

function OperationalSetting({
  id,
  name,
  label,
  value,
  error,
  t,
  inputProps,
}: {
  id: string;
  name: string;
  label: string;
  value: string;
  error: string | undefined;
  t: Record<string, string>;
  inputProps?: ComponentProps<typeof Input>;
}) {
  const errorId = `${id}-error`;
  return (
    <SettingRow
      label={label}
      htmlFor={id}
      fluidControl
      control={
        <div className="flex w-full flex-col gap-1">
          <Input
            {...inputProps}
            id={id}
            name={name}
            defaultValue={value}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : undefined}
          />
          <FieldError id={errorId} error={error} t={t} />
        </div>
      }
    />
  );
}
