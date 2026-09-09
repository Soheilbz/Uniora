"use client";

import { Pencil } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Fragment, useActionState, useState } from "react";
import { Notice } from "@/components/engine/notice";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toLocaleDigits } from "@/lib/digits.ts";
import type { ActionResult } from "@/lib/register/action-result.ts";
import { type BulkEditableField, MAX_BULK_EDIT_RECORDS } from "@/lib/register/bulk-edit.ts";
import { ToolbarButton } from "./toolbar";

/**
 * Setting one field across the rows that are ticked.
 *
 * ── One field, from a list, with a value from a list ────────────────────────
 *
 * Both halves are chosen rather than typed, and that is the whole shape of the
 * feature: this is the one operation in the registry that writes to records the
 * operator is not looking at, so the room for a mistake is narrowed to picking
 * the wrong item from two short menus. The allow-list of fields is the
 * register's own and the action re-checks it — the dialog constrains a form,
 * not an endpoint.
 *
 * ── It says how many it actually changed ────────────────────────────────────
 *
 * Not how many were selected. A record somebody else edited between the tick
 * and the apply is skipped by the version guard, and «۴۰ انتخاب شد، ۳۸ تغییر
 * کرد» is the only honest report of that. Reporting the selection back would
 * make a partial write look complete.
 */
export function BulkEditDialog({
  fields,
  selected,
  versionsById,
  action,
  disabled,
}: {
  fields: BulkEditableField[];
  /** The ticked row ids, in the order the table holds them. */
  selected: string[];
  /**
   * The version each row was read at, by id.
   *
   * Posted beside the id so the action can match each write to the version
   * this screen saw: a record edited between ticking and applying is skipped
   * and left out of the count rather than silently overwritten. A row with no
   * version here is treated as stale from the start — the register that did
   * not supply one has nothing for the guard to check.
   */
  versionsById: ReadonlyMap<string, number>;
  action: (previous: ActionResult | null, form: FormData) => Promise<ActionResult>;
  disabled: boolean;
}) {
  const t = useTranslations("bulkEdit");
  const common = useTranslations("common");
  const say = useTranslations();
  const locale = useLocale();

  const [open, setOpen] = useState(false);
  const [fieldKey, setFieldKey] = useState<string | null>(fields[0]?.key ?? null);
  const [value, setValue] = useState<string | null>(null);
  const [result, submit, saving] = useActionState(action, null);

  const field = fields.find((candidate) => candidate.key === fieldKey);
  const tooMany = selected.length > MAX_BULK_EDIT_RECORDS;

  return (
    <>
      <ToolbarButton
        icon={<Pencil className="size-4" aria-hidden />}
        disabled={disabled || fields.length === 0}
        onClick={() => setOpen(true)}
      >
        {t("action")}
        {/* Localised here too: the dialog this opens says «۲ رکورد», and a
            button reading «(2)» beside it is the same count spelled two ways. */}
        {selected.length > 0 && ` (${toLocaleDigits(String(selected.length), locale)})`}
      </ToolbarButton>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>{t("title")}</DialogTitle>
            <DialogDescription>{t("description", { count: selected.length })}</DialogDescription>
          </DialogHeader>

          {tooMany ? (
            <Notice intent="warning" title={t("tooManyTitle")}>
              {t("tooMany", { max: MAX_BULK_EDIT_RECORDS })}
            </Notice>
          ) : (
            <form action={submit} className="flex flex-col gap-4">
              {selected.map((id) => {
                const version = versionsById.get(id);
                return (
                  <Fragment key={id}>
                    <input type="hidden" name="id" value={id} />
                    {/* Named per row rather than as a parallel array: one row
                        without a version would silently shift every version
                        after it onto the wrong id. The action looks each up by
                        its own id; a row that posts none is treated as stale. */}
                    {version !== undefined && (
                      <input type="hidden" name={`version.${id}`} value={version} />
                    )}
                  </Fragment>
                );
              })}

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="bulk-field">{t("field")}</Label>
                <Select
                  value={fieldKey}
                  /* Choosing a different field clears the value: a status
                     identifier is not a degree identifier, and carrying one
                     over posts a value the action refuses — correctly, and
                     confusingly. */
                  onValueChange={(next: string | null) => {
                    setFieldKey(next);
                    setValue(null);
                  }}
                >
                  <SelectTrigger id="bulk-field" className="w-full">
                    <SelectValue>
                      {(current: string) =>
                        fields.find((candidate) => candidate.key === current)?.label ?? t("field")
                      }
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {fields.map((candidate) => (
                      <SelectItem key={candidate.key} value={candidate.key}>
                        {candidate.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <input type="hidden" name="field" value={fieldKey ?? ""} />
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="bulk-value">{t("value")}</Label>
                {/* Keyed by field, so switching field builds a fresh select
                    rather than keeping the previous one's chosen item. */}
                <Select key={fieldKey ?? ""} value={value} onValueChange={setValue}>
                  <SelectTrigger id="bulk-value" className="w-full">
                    <SelectValue>
                      {(current: string) =>
                        field?.options.find((option) => option.value === current)?.label ??
                        t("value")
                      }
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {(field?.options ?? []).map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <input type="hidden" name="value" value={value ?? ""} />
              </div>

              {result?.message && <p className="text-xs text-destructive">{say(result.message)}</p>}
              {result?.ok && result.values?.changed && (
                <p className="text-xs text-muted-foreground">
                  {t("changed", { count: Number(result.values.changed) })}
                </p>
              )}

              <div className="flex justify-end gap-2 border-t pt-4">
                <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                  {common("cancel")}
                </Button>
                <Button type="submit" disabled={!fieldKey || !value || saving}>
                  {t("apply")}
                </Button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
