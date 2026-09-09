"use client";

import { Lock } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Combobox } from "@/components/ui/combobox";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { FormOption } from "@/lib/lookups.ts";
import type { AnyFieldSpec } from "@/lib/register/field-spec.ts";
import { cn } from "@/lib/utils";

export function EntityFormField({
  id,
  field,
  label,
  multiline,
  hint,
  value,
  onValueChange,
  options,
  parentValue,
  onParentChange,
  error,
  isLocked,
  lockedLabel,
}: {
  id: string;
  field: AnyFieldSpec;
  label: string;
  multiline: boolean;
  hint: string | undefined;
  value: string;
  onValueChange: ((value: string) => void) | undefined;
  options: FormOption[];
  parentValue: string | undefined;
  onParentChange: ((value: string) => void) | undefined;
  error: string | undefined;
  isLocked?: boolean;
  lockedLabel: string;
}) {
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const narrowed =
    field.narrowedBy === undefined
      ? options
      : parentValue
        ? options.filter((option) => option.parent === parentValue)
        : [];
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(" ");

  let control: React.ReactNode;
  if (isLocked) {
    const displayValue =
      field.kind === "lookup" || field.kind === "choice"
        ? (options.find((option) => option.value === value)?.label ?? value)
        : value;
    control = (
      <div className="relative">
        <input type="hidden" name={field.key} value={value} />
        <Input
          id={id}
          type="text"
          value={displayValue}
          readOnly
          disabled
          className="cursor-not-allowed bg-muted/70 text-muted-foreground border-dashed border-border/80 select-none text-xs"
        />
      </div>
    );
  } else if (
    (field.kind === "choice" ||
      field.kind === "lookup" ||
      field.kind === "reference" ||
      options.length > 0) &&
    field.kind !== "boolean" &&
    field.kind !== "date" &&
    !multiline
  ) {
    control = (
      <Combobox
        id={id}
        name={field.key}
        aria-label={label}
        value={value}
        onChange={(next) => {
          onValueChange?.(next);
          onParentChange?.(next);
        }}
        options={narrowed}
        disabled={field.narrowedBy !== undefined && !parentValue}
        required={field.required}
        allowCustom={field.allowCustom ?? field.kind === "text"}
        aria-invalid={Boolean(error)}
        {...(describedBy ? { "aria-describedby": describedBy } : {})}
      />
    );
  } else if (field.kind === "boolean") {
    control = (
      <div className="flex items-center gap-2">
        <Checkbox
          id={id}
          name={field.key}
          value="on"
          checked={value === "true"}
          onCheckedChange={(checked) => onValueChange?.(checked ? "true" : "false")}
          {...(describedBy ? { "aria-describedby": describedBy } : {})}
        />
        <Label htmlFor={id} className="font-normal">
          {label}
        </Label>
      </div>
    );
  } else if (field.kind === "date") {
    control = (
      <DatePicker
        id={id}
        name={field.key}
        value={value}
        onChange={(next) => onValueChange?.(next)}
        required={field.required}
        ariaLabel={label}
        ariaInvalid={Boolean(error)}
        ariaDescribedBy={describedBy}
        className="w-full"
      />
    );
  } else if (multiline) {
    control = (
      <Textarea
        id={id}
        name={field.key}
        value={value}
        onChange={(event) => onValueChange?.(event.target.value)}
        rows={6}
        {...(field.maxLength ? { maxLength: field.maxLength } : {})}
        aria-invalid={Boolean(error)}
        {...(describedBy ? { "aria-describedby": describedBy } : {})}
        className={cn(error && "border-destructive")}
      />
    );
  } else {
    const numeric =
      field.kind === "number" ||
      field.format === "digits" ||
      field.format === "nationalId" ||
      field.format === "tel";
    control = (
      /*
       * Keep this editable control native. The record form is submitted as a
       * real FormData payload, and WebKit has exposed a particularly dangerous
       * edge here: the Base UI input wrapper could display a value typed into
       * a digit-formatted field while its controlled value was still empty at
       * the moment a server-action submission serialized the form. That made
       * the server correctly reject a record as missing its identifier even
       * though the operator had visibly filled it in. A native input with an
       * `onInput` bridge makes the DOM value and React state advance on the
       * same browser-level event in every engine; the server remains the
       * source of truth and still validates the submitted value.
       */
      <input
        data-slot="input"
        id={id}
        name={field.key}
        type={field.format === "email" ? "email" : "text"}
        value={value}
        onInput={(event) => onValueChange?.(event.currentTarget.value)}
        {...(field.maxLength ? { maxLength: field.maxLength } : {})}
        {...(numeric ? { inputMode: "numeric" as const, dir: "ltr" } : {})}
        {...(field.format === "email" || field.format === "code" ? { dir: "ltr" } : {})}
        {...(field.required ? { required: true } : {})}
        aria-invalid={Boolean(error)}
        {...(describedBy ? { "aria-describedby": describedBy } : {})}
        className={cn(numeric && "numeric text-start", error && "border-destructive")}
      />
    );
  }

  return (
    <div className={cn("flex flex-col gap-1.5", multiline && "sm:col-span-2 lg:col-span-3")}>
      {field.kind !== "boolean" ? (
        <Label
          htmlFor={id}
          className="text-xs font-semibold text-foreground/90 flex items-center justify-between gap-1"
        >
          <span className="flex items-center gap-1">
            <span>{label}</span>
            {field.required && !isLocked ? (
              <span className="text-destructive font-bold text-sm leading-none" aria-hidden>
                *
              </span>
            ) : null}
          </span>
          {isLocked ? (
            <span className="inline-flex items-center gap-1 rounded bg-muted/80 px-1.5 py-0.5 text-[10px] font-normal text-muted-foreground">
              <Lock className="size-3 text-muted-foreground/80" aria-hidden />
              <span>{lockedLabel}</span>
            </span>
          ) : null}
        </Label>
      ) : null}
      {control}
      {hint ? (
        <p id={hintId} className="text-[11px] text-muted-foreground leading-relaxed">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
