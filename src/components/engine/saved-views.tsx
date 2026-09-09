"use client";

import { Bookmark, Trash2 } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useActionState, useEffect, useState } from "react";
import { toast } from "sonner";
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
import type { ActionResult } from "@/lib/register/action-result.ts";
import type { SavedView } from "@/lib/register/saved-views.ts";
import { ToolbarButton } from "./toolbar";

export function SavedViewsMenu({
  register,
  query,
  views,
  saveAction,
  deleteAction,
  canPublish = false,
}: {
  register: string;
  query: string;
  views: SavedView[];
  saveAction: (previous: ActionResult | null, form: FormData) => Promise<ActionResult>;
  deleteAction: (previous: ActionResult | null, form: FormData) => Promise<ActionResult>;
  canPublish?: boolean;
}) {
  const t = useTranslations("views");
  const common = useTranslations("common");
  const say = useTranslations();
  const [open, setOpen] = useState(false);
  const [saved, save, saving] = useActionState(saveAction, null);
  const [removed, remove, removing] = useActionState(deleteAction, null);

  useEffect(() => {
    if (saved?.ok) toast.success(t("saved"));
    else if (saved?.message) toast.error(say(saved.message));
  }, [saved, t, say]);

  useEffect(() => {
    if (removed && !removed.ok) {
      toast.error(removed.message ? say(removed.message) : common("formSaveFailed"));
    }
  }, [removed, say, common]);

  const href = (one: SavedView) => (one.query === "" ? register : `${register}?${one.query}`);

  return (
    <div className="inline-flex">
      <ToolbarButton
        icon={<Bookmark className="size-4" aria-hidden />}
        onClick={() => setOpen(true)}
      >
        {t("title")}
      </ToolbarButton>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("title")}</DialogTitle>
            <DialogDescription>{t("emptyHint")}</DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4">
            <form action={save} className="grid gap-3 sm:grid-cols-[1fr_11rem_auto] sm:items-end">
              <input type="hidden" name="register" value={register} />
              <input type="hidden" name="query" value={query} />
              <label className="flex min-w-0 flex-col gap-1 text-sm">
                <span className="font-medium">{t("name")}</span>
                <Input
                  name="name"
                  placeholder={t("namePlaceholder")}
                  maxLength={60}
                  required
                  aria-invalid={Boolean(saved?.errors?.name)}
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium">{t("scopeLabel")}</span>
                <select
                  name="scope"
                  defaultValue="private"
                  className="h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <option value="private">{t("scope.private")}</option>
                  {canPublish && <option value="team">{t("scope.team")}</option>}
                  {canPublish && <option value="tenant">{t("scope.tenant")}</option>}
                </select>
              </label>
              <Button type="submit" size="sm" disabled={saving}>
                {t("save")}
              </Button>
              {saved?.errors?.name && (
                <p className="text-xs text-destructive sm:col-span-3">{say(saved.errors.name)}</p>
              )}
            </form>

            {views.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("empty")}</p>
            ) : (
              <ul className="flex max-h-72 flex-col divide-y overflow-y-auto rounded-md border">
                {views.map((one) => (
                  <li key={one.id} className="flex items-center justify-between gap-2 px-3 py-2">
                    <Link
                      href={href(one)}
                      onClick={() => setOpen(false)}
                      className="min-w-0 flex-1 truncate text-sm underline-offset-4 hover:underline"
                    >
                      {one.name}
                    </Link>
                    <Badge variant="outline" className="shrink-0 text-[10px]">
                      {t(`scope.${one.scope}`)}
                    </Badge>
                    {one.owned && (
                      <form action={remove}>
                        <input type="hidden" name="id" value={one.id} />
                        <input type="hidden" name="register" value={register} />
                        <Button
                          type="submit"
                          variant="ghost"
                          size="icon-sm"
                          disabled={removing}
                          aria-label={`${t("remove")} — ${one.name}`}
                        >
                          <Trash2 className="size-4" aria-hidden />
                        </Button>
                      </form>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setOpen(false)}>
              {common("close")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
