"use client";

import { AlertCircle, Loader2 } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { type ReactNode, useActionState, useEffect, useId, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { FormOption } from "@/lib/lookups.ts";
import type { ActionResult } from "@/lib/register/action-result.ts";
import type { AnyFieldSpec } from "@/lib/register/field-spec.ts";
import { cn } from "@/lib/utils";
import { EntityFormField } from "./entity-form-field";
import { useUnsavedLeaveGuard } from "./use-unsaved-leave-guard";

/**
 * The record form, built from field specs.
 *
 * One `<form>` posting to a Server Action, not a client-side validation
 * framework. The submit is a real form submission, so it works before the
 * JavaScript has arrived, and the errors that come back are the *server's* — the
 * same rules that decide whether the record is written, rather than a second
 * implementation of them that can disagree.
 */

/** A field, as this form needs it: everything but the register's own group union. */
export type FormField_ = AnyFieldSpec;

export interface EntityFormProps {
  action: (previous: ActionResult | null, form: FormData) => Promise<ActionResult>;
  fields: readonly FormField_[];
  groups: readonly string[];
  /** Options per field key, already narrowed to this institution. */
  options: Record<string, FormOption[]>;
  /** The current values, as strings — an empty string means "not recorded". */
  values: Record<string, string>;
  /** Labels, resolved on the server where the catalogue lives. */
  labels: Record<string, string>;
  groupLabels: Record<string, { title: string; hint: string }>;
  hints: Record<string, string>;
  /** Present on an edit, absent on a new record. */
  recordId?: string | undefined;
  version?: number | undefined;
  cancelHref: string;
  submitLabel: string;
  /** Fields that hold more than a line. */
  multiline?: readonly string[] | undefined;
  /** Values the form carries but never shows. */
  extraFields?: Record<string, string> | undefined;
  /** Optional custom slot component or renderer for specific section groups */
  customGroupSlots?:
    | Record<
        string,
        | ReactNode
        | ((context: {
            formValues: Record<string, string>;
            onFieldChange: (key: string, value: string) => void;
            options: Record<string, FormOption[]>;
            fieldError: (key: string) => string | undefined;
          }) => ReactNode)
      >
    | undefined;
  /** Optional dynamic autofill mapping: sourceKey -> sourceValue -> targetFields */
  autofillMap?: Record<string, Record<string, Record<string, string>>> | undefined;
  /** Fields shown but not editable for this viewer. Their original value is still posted. */
  lockedFields?: readonly string[] | undefined;
}

export function EntityForm({
  action,
  fields,
  groups,
  options,
  values,
  labels,
  groupLabels,
  hints,
  recordId,
  version,
  cancelHref,
  submitLabel,
  multiline = [],
  extraFields = {},
  customGroupSlots,
  autofillMap,
  lockedFields = [],
}: EntityFormProps) {
  const t = useTranslations("common");
  const errors = useTranslations("errors");
  const [result, submit, pending] = useActionState(action, null);
  const formId = useId();

  const [formValues, setFormValues] = useState<Record<string, string>>(() => ({
    ...values,
    ...(result?.values ?? {}),
  }));

  useEffect(() => {
    if (result?.values) {
      setFormValues((prev) => ({ ...prev, ...result.values }));
    }
  }, [result?.values]);

  useEffect(() => {
    if (result?.ok && result.message) {
      toast.success(errors(result.message as string));
    }
  }, [result, errors]);

  /*
   * The values that other fields depend on, tracked so narrowing is immediate.
   */
  const [parents, setParents] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      fields
        .filter((field) => fields.some((other) => other.narrowedBy === field.key))
        .map((field) => [field.key, values[field.key] ?? ""]),
    ),
  );

  const [activeGroup, setActiveGroup] = useState<string>(() => groups[0] ?? "");

  /*
   * Track fields that have been auto-populated from an existing master record
   * (e.g. meeting details or student details) and should be locked to prevent discrepancies.
   */
  const lockedKeys = useMemo(() => {
    const locked = new Map<string, string>();
    for (const key of lockedFields) locked.set(key, "permission");
    for (const [sourceKey, sourceVal] of Object.entries(formValues)) {
      if (sourceVal && autofillMap?.[sourceKey]?.[sourceVal]) {
        const fills = autofillMap[sourceKey][sourceVal];
        for (const targetKey of Object.keys(fills)) {
          if (
            fills[targetKey] !== undefined &&
            fills[targetKey] !== null &&
            fills[targetKey] !== ""
          ) {
            locked.set(targetKey, sourceKey);
          }
        }
      }
    }
    return locked;
  }, [formValues, autofillMap, lockedFields]);

  /*
   * Filter visible groups based on dynamic state (such as reportCategory for Council Decisions).
   */
  const visibleGroups = useMemo(() => {
    const category = formValues.reportCategory;
    if (!category) return groups;

    const isProposalStage =
      category.includes("پیشنهاده") ||
      ["thesis_proposal", "dissertation_proposal"].includes(category);

    const isFinalStage =
      category.includes("دفاع نهایی") ||
      category.includes("مجوز دفاع") ||
      ["thesis_final_defense", "dissertation_final_defense"].includes(category);

    return groups.filter((g) => {
      if (g === "proposalDocs" && !isProposalStage) return false;
      if (g === "defenseDocs" && !isFinalStage) return false;
      return true;
    });
  }, [groups, formValues.reportCategory]);

  useEffect(() => {
    if (visibleGroups.length > 0 && !visibleGroups.includes(activeGroup)) {
      setActiveGroup(visibleGroups[0] ?? "");
    }
  }, [visibleGroups, activeGroup]);

  const handleFieldChange = (fieldKey: string, nextValue: string) => {
    setFormValues((prev) => {
      const updated = { ...prev, [fieldKey]: nextValue };
      if (autofillMap?.[fieldKey]?.[nextValue]) {
        const fills = autofillMap[fieldKey][nextValue];
        for (const [targetKey, targetVal] of Object.entries(fills)) {
          if (targetVal !== undefined && targetVal !== null) {
            updated[targetKey] = targetVal;
          }
        }
      }
      return updated;
    });

    if (fields.some((other) => other.narrowedBy === fieldKey)) {
      setParents((current) => ({ ...current, [fieldKey]: nextValue }));
    }
  };

  /*
   * Automatically focus the tab containing an error when validation fails.
   */
  useEffect(() => {
    if (result?.errors) {
      const errorKeys = Object.keys(result.errors);
      const groupWithError = visibleGroups.find((g) =>
        fields.some((f) => f.group === g && errorKeys.includes(f.key)),
      );
      if (groupWithError) {
        setActiveGroup(groupWithError);
      }
    }
  }, [result?.errors, visibleGroups, fields]);

  const fieldError = (key: string) => result?.errors?.[key];

  /*
   * ── Leaving with unsaved work ─────────────────────────────────────────────
   */
  const { leaving, setLeaving, markDirty, stay, leave } = useUnsavedLeaveGuard(Boolean(result?.ok));

  return (
    <>
      <form
        noValidate
        action={submit}
        onInput={() => {
          markDirty();
        }}
        /*
         * Nothing clears `dirty` here, on submit.
         *
         * Submitting is not saving: a save that comes back with validation
         * errors leaves every field exactly as unsaved as it was, and a guard
         * stood down at submit time would let one accidental click on a nav
         * link discard the lot. The effect above is the only thing that
         * disarms this — when an action reports `ok`, which is the only event
         * that actually means "saved".
         */
        className="flex flex-col gap-4 sm:gap-5"
      >
        {recordId && <input type="hidden" name="id" value={recordId} />}
        {version !== undefined && <input type="hidden" name="version" value={version} />}
        {Object.entries(extraFields).map(([name, val]) => (
          <input key={name} type="hidden" name={name} value={val} />
        ))}

        {result && !result.ok && (
          <div className="flex flex-col gap-2 rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-xs font-medium text-destructive shadow-2xs">
            <div className="flex items-center gap-2 font-bold text-sm">
              <AlertCircle className="size-4.5 shrink-0 text-destructive" />
              <span>{result.message ? errors(result.message as string) : t("formSaveFailed")}</span>
            </div>
            {result.errors && Object.keys(result.errors).length > 0 && (
              <ul className="list-disc list-inside ps-2 flex flex-col gap-1 text-xs text-destructive/90">
                {Object.entries(result.errors).map(([fieldKey, errMessage]) => {
                  const fieldName = labels[fieldKey] ?? fieldKey;
                  /* Each line is a jump: clicking it opens the tab the field
                     lives in, because «شماره پرونده الزامی است» naming a field
                     on a hidden tab sent the reader hunting through four tabs
                     for a box they could not see was empty. */
                  const fieldGroup = fields.find((f) => f.key === fieldKey)?.group;
                  const clickable = fieldGroup !== undefined && fieldGroup !== activeGroup;
                  return (
                    <li key={fieldKey}>
                      {clickable ? (
                        <button
                          type="button"
                          onClick={() => setActiveGroup(fieldGroup)}
                          className="underline decoration-dotted underline-offset-2 hover:text-destructive transition-colors"
                        >
                          <span className="font-semibold">{fieldName}</span>
                        </button>
                      ) : (
                        <span className="font-semibold">{fieldName}</span>
                      )}
                      : {errors(errMessage as string)}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}

        {/* Multi-Section Tabs Navigation if more than 1 group */}
        {visibleGroups.length > 1 && (
          <div className="flex flex-wrap gap-1.5 border-b border-border/70 pb-3">
            {visibleGroups.map((group) => {
              const count = fields.filter((f) => f.group === group).length;
              const hasGroupError = fields.some(
                (f) => f.group === group && result?.errors?.[f.key],
              );
              const isActive = activeGroup === group;

              return (
                <button
                  key={group}
                  type="button"
                  onClick={() => setActiveGroup(group)}
                  aria-pressed={isActive}
                  className={cn(
                    "relative flex items-center gap-2 rounded-lg px-3.5 py-2 text-xs font-semibold transition-all shadow-2xs",
                    isActive
                      ? "bg-primary text-primary-foreground shadow-xs"
                      : "bg-card text-muted-foreground hover:bg-muted hover:text-foreground",
                    hasGroupError && "border-b-2 border-destructive text-destructive",
                  )}
                >
                  <span>{groupLabels[group]?.title ?? group}</span>
                  {count > 0 && (
                    <span
                      className={cn(
                        "rounded-full px-1.5 py-0.5 text-[10px]",
                        isActive
                          ? "bg-primary-foreground text-primary"
                          : "bg-muted text-muted-foreground",
                      )}
                    >
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}

        {/* Section Cards */}
        {visibleGroups.map((group) => {
          const isHidden = visibleGroups.length > 1 && activeGroup !== group;

          if (customGroupSlots?.[group]) {
            const slot = customGroupSlots[group];
            return (
              <Card
                key={group}
                className={cn(
                  "overflow-visible relative border-border/80 bg-card shadow-2xs transition-shadow hover:shadow-xs",
                  isHidden && "hidden",
                )}
              >
                <CardHeader className="rounded-t-xl border-b border-border/60 bg-muted/20 px-4 py-3 sm:px-5">
                  <CardTitle className="text-sm font-bold text-foreground">
                    {groupLabels[group]?.title}
                  </CardTitle>
                  {groupLabels[group]?.hint && (
                    <CardDescription className="text-xs text-muted-foreground mt-0.5">
                      {groupLabels[group]?.hint}
                    </CardDescription>
                  )}
                </CardHeader>
                <CardContent className="p-4 sm:p-5">
                  {typeof slot === "function"
                    ? slot({
                        formValues,
                        onFieldChange: handleFieldChange,
                        options,
                        fieldError: (key) => {
                          const code = fieldError(key);
                          return code ? (errors(code as string) as string) : undefined;
                        },
                      })
                    : slot}
                </CardContent>
              </Card>
            );
          }

          return (
            <Card
              key={group}
              className={cn(
                "overflow-visible relative border-border/80 bg-card shadow-2xs transition-shadow hover:shadow-xs",
                isHidden && "hidden",
              )}
            >
              <CardHeader className="rounded-t-xl border-b border-border/60 bg-muted/20 px-4 py-3 sm:px-5">
                <CardTitle className="text-sm font-bold text-foreground">
                  {groupLabels[group]?.title}
                </CardTitle>
                {groupLabels[group]?.hint && (
                  <CardDescription className="text-xs text-muted-foreground mt-0.5">
                    {groupLabels[group]?.hint}
                  </CardDescription>
                )}
              </CardHeader>
              <CardContent className="p-4 sm:p-5">
                {customGroupSlots?.[group] ? (
                  typeof customGroupSlots[group] === "function" ? (
                    customGroupSlots[group]({
                      formValues,
                      onFieldChange: handleFieldChange,
                      options,
                      fieldError: (key) => {
                        const code = fieldError(key);
                        return code ? (errors(code as string) as string) : undefined;
                      },
                    })
                  ) : (
                    customGroupSlots[group]
                  )
                ) : (
                  <div className="grid grid-cols-1 gap-x-4 gap-y-3.5 sm:grid-cols-2 lg:grid-cols-3">
                    {fields
                      .filter((field) => field.group === group)
                      .map((field) => (
                        <EntityFormField
                          key={field.key}
                          id={`${formId}-${field.key}`}
                          field={field}
                          label={labels[field.key] ?? field.key}
                          multiline={multiline.includes(field.key)}
                          hint={field.hint ? hints[field.hint] : undefined}
                          value={formValues[field.key] ?? ""}
                          onValueChange={(val) => handleFieldChange(field.key, val)}
                          options={options[field.key] ?? []}
                          parentValue={
                            field.narrowedBy ? (parents[field.narrowedBy] ?? "") : undefined
                          }
                          onParentChange={
                            fields.some((other) => other.narrowedBy === field.key)
                              ? (val) => setParents((current) => ({ ...current, [field.key]: val }))
                              : undefined
                          }
                          error={
                            fieldError(field.key)
                              ? (errors(fieldError(field.key) as string) as string)
                              : undefined
                          }
                          isLocked={lockedKeys.has(field.key)}
                          lockedLabel={t("locked")}
                        />
                      ))}
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}

        {/* Submit Actions */}
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border/60 bg-card/80 p-3.5 px-4 shadow-2xs backdrop-blur-xs">
          <Button type="submit" disabled={pending} className="px-5 font-semibold shadow-xs">
            {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
            {submitLabel}
          </Button>
          <Button
            variant="ghost"
            nativeButton={false}
            className="text-xs font-medium"
            render={<Link href={cancelHref}>{t("back")}</Link>}
          />
        </div>
      </form>

      <Dialog open={leaving !== null} onOpenChange={(next) => !next && setLeaving(null)}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>{t("unsavedTitle")}</DialogTitle>
            <DialogDescription>{t("unsavedBody")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={stay}>
              {t("unsavedStay")}
            </Button>
            <Button variant="destructive" onClick={leave}>
              {t("unsavedLeave")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
