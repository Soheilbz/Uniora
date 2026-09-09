"use client";

import { Check, RotateCcw, X } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useActionState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { createDateTimeFormatter } from "@/lib/locale-format";
import type { ActionResult } from "@/lib/register/action-result.ts";

export interface WorkshopRegistrationView {
  id: string;
  version: number;
  fullName: string;
  email: string | null;
  phone: string | null;
  externalReference: string | null;
  status: string;
  source: string;
  participantId: string | null;
  createdAt: Date;
}

export function RegistrationList({
  rows,
  canManage,
  transition,
}: {
  rows: WorkshopRegistrationView[];
  canManage: boolean;
  transition: (previous: ActionResult | null, form: FormData) => Promise<ActionResult>;
}) {
  const t = useTranslations("workshops.registrations");
  const locale = useLocale();
  const dateTimeFormatter = createDateTimeFormatter(locale);
  const [result, action, pending] = useActionState(transition, null);

  if (rows.length === 0) return <p className="text-sm text-muted-foreground">{t("empty")}</p>;

  return (
    <div className="space-y-3">
      {result && !result.ok && (
        <p
          role="alert"
          className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
        >
          {t("actionFailed")}
        </p>
      )}
      <div className="divide-y rounded-lg border">
        {rows.map((row) => (
          <article
            key={row.id}
            className="grid gap-3 p-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center"
          >
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="font-medium">{row.fullName}</h3>
                <Badge variant="outline">{t(`status.${row.status}`)}</Badge>
                <Badge variant="secondary">{t(`source.${row.source}`)}</Badge>
              </div>
              <p className="mt-1 break-words text-xs text-muted-foreground">
                {[row.email, row.phone, row.externalReference].filter(Boolean).join(" · ") ||
                  t("noContact")}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {t("received", { date: dateTimeFormatter.format(row.createdAt) })}
              </p>
            </div>
            {canManage && (
              <form action={action} className="flex flex-wrap gap-2">
                <input type="hidden" name="registrationId" value={row.id} />
                <input type="hidden" name="version" value={row.version} />
                {row.status === "pending" && (
                  <>
                    <Button size="sm" name="status" value="approved" disabled={pending}>
                      <Check className="size-4" aria-hidden />
                      {t("approve")}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      name="status"
                      value="rejected"
                      disabled={pending}
                    >
                      <X className="size-4" aria-hidden />
                      {t("reject")}
                    </Button>
                  </>
                )}
                {(row.status === "rejected" || row.status === "cancelled") && (
                  <Button
                    size="sm"
                    variant="outline"
                    name="status"
                    value="pending"
                    disabled={pending}
                  >
                    <RotateCcw className="size-4" aria-hidden />
                    {t("reopen")}
                  </Button>
                )}
                {row.status === "approved" && (
                  <Button
                    size="sm"
                    variant="outline"
                    name="status"
                    value="cancelled"
                    disabled={pending}
                  >
                    <X className="size-4" aria-hidden />
                    {t("cancel")}
                  </Button>
                )}
              </form>
            )}
          </article>
        ))}
      </div>
    </div>
  );
}
