"use client";

import { Pencil, Plus, Search, Trash2 } from "lucide-react";
import { useActionState, useEffect, useState, useTransition } from "react";
import { Feedback } from "@/components/settings/profile-forms";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { ActionResult } from "@/lib/register/action-result.ts";
import { cn } from "@/lib/utils";
import type { RoleView } from "@/modules/settings/role-queries.ts";

type Action = (previous: ActionResult | null, form: FormData) => Promise<ActionResult>;

/**
 * A count substituted into a sentence, in the numerals beside it.
 *
 * `{count} کاربر` is filled here rather than by the message formatter,
 * because the sentence is chosen on the server and the number is only known in
 * the browser. Without this the row reads «3 کاربر» — a Latin figure in a
 * Persian sentence, which is the one thing every other screen in this
 * application is careful not to do.
 */
function count(template: string | undefined, value: number, locale: string): string {
  const formatted = new Intl.NumberFormat(locale === "fa" ? "fa-IR" : "en-US").format(value);
  return (template ?? "").replace("{count}", formatted);
}

/** A capability, as this screen presents it: a name and what it permits. */
export interface CapabilityChoice {
  key: string;
  name: string;
  what: string;
  group: string;
  /** False where the viewer does not hold it themselves and so cannot grant it. */
  grantable: boolean;
}

export function RoleEditor({
  roles,
  capabilities,
  tiers,
  save,
  remove,
  t,
  locale,
}: {
  roles: RoleView[];
  capabilities: CapabilityChoice[];
  /** The tiers this viewer may create, lowest first. */
  tiers: { value: string; label: string }[];
  save: Action;
  remove: Action;
  t: Record<string, string>;
  locale: string;
}) {
  const [saveResult, submitSave, saving] = useActionState(save, null);
  const [removeResult, submitRemove, removing] = useActionState(remove, null);
  const [, startTransition] = useTransition();

  /** The role open in the dialog: an existing one, or `null` for a new one. */
  const [editing, setEditing] = useState<RoleView | "new" | null>(null);
  const [confirming, setConfirming] = useState<RoleView | null>(null);
  const [lastSaveTarget, setLastSaveTarget] = useState<string | null>(null);
  const [lastRemoveId, setLastRemoveId] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (saveResult?.ok) setEditing(null);
  }, [saveResult]);

  useEffect(() => {
    if (removeResult?.ok) setConfirming(null);
  }, [removeResult]);

  const groups = [...new Set(capabilities.map((one) => one.group))];
  const filteredRoles = roles.filter((role) => {
    const query = search.trim().toLowerCase();
    return (
      query === "" ||
      role.name.toLowerCase().includes(query) ||
      role.key.toLowerCase().includes(query)
    );
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold">{t.title}</h2>
          <Badge
            variant="outline"
            className="text-xs font-mono font-semibold text-muted-foreground"
          >
            {filteredRoles.length} {t.count}
          </Badge>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-full max-w-56">
            <Search className="pointer-events-none absolute start-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t.searchPlaceholder}
              aria-label={t.searchPlaceholder}
              className="h-8 ps-8 text-xs"
            />
          </div>
          {tiers.length > 0 && (
            <Button
              onClick={() => {
                setLastSaveTarget(null);
                setEditing("new");
              }}
            >
              <Plus className="size-4" aria-hidden />
              {t.add}
            </Button>
          )}
        </div>
      </div>

      <div className="rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t.columnRole}</TableHead>
              <TableHead className="w-40">{t.tier}</TableHead>
              <TableHead className="w-32">{t.columnAccess}</TableHead>
              <TableHead className="w-32">{t.columnHolders}</TableHead>
              <TableHead className="w-24" aria-label={t.editTitle ?? ""}>
                <span className="sr-only">{t.editTitle}</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredRoles.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
                  {roles.length === 0 ? t.empty : t.emptySearch}
                </TableCell>
              </TableRow>
            )}
            {filteredRoles.map((role) => (
              <TableRow key={role.id}>
                <TableCell>
                  <div className="flex flex-col gap-0.5">
                    <span className="flex items-center gap-2 text-sm font-medium">
                      {role.name}
                      {role.isSystem && (
                        <Badge variant="outline" className="font-normal text-muted-foreground">
                          {t.system}
                        </Badge>
                      )}
                    </span>
                    <span className="numeric text-xs text-muted-foreground" dir="ltr">
                      {role.key}
                    </span>
                  </div>
                </TableCell>
                <TableCell className="text-sm">{t[`tier.${role.tier}`] ?? role.tier}</TableCell>
                <TableCell className="text-sm">
                  {role.capabilities.length === capabilities.length
                    ? t.allCapabilities
                    : `${count("{count}", role.capabilities.length, locale)} ${t.capabilityCount}`}
                </TableCell>
                <TableCell className="text-sm">
                  {role.holders === 0 ? (
                    <span className="text-muted-foreground">{t.noHolders}</span>
                  ) : (
                    count(t.holders, role.holders, locale)
                  )}
                </TableCell>
                <TableCell>
                  <div className="flex items-center justify-end gap-0.5">
                    {/*
                     * Not disabled — absent, with the reason beside it.
                     *
                     * A greyed button on a role above your level teaches nothing;
                     * «این نقش بیش از دسترسی‌های خودتان دارد» is the answer to
                     * the question the greyed button raises.
                     */}
                    {role.editable ? (
                      <>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`${t.editTitle} — ${role.name}`}
                          onClick={() => {
                            setLastSaveTarget(null);
                            setEditing(role);
                          }}
                        >
                          <Pencil className="size-4" aria-hidden />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`${t.deleteTitle?.replace("{name}", role.name)}`}
                          onClick={() => {
                            setLastRemoveId(null);
                            setConfirming(role);
                          }}
                        >
                          <Trash2 className="size-4" aria-hidden />
                        </Button>
                      </>
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        {role.isSystem ? t.system : t.beyondYourLevel}
                      </span>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Feedback result={saveResult} t={t} />
      <Feedback result={removeResult} t={t} />

      {/* ── The role dialog ─────────────────────────────────────────────── */}
      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto" showCloseButton={false}>
          <form
            key={editing === "new" ? "new" : (editing?.id ?? "closed")}
            action={submitSave}
            onSubmit={() => setLastSaveTarget(editing === "new" ? "new" : (editing?.id ?? null))}
          >
            <DialogHeader>
              <DialogTitle>{editing === "new" ? t.newTitle : t.editTitle}</DialogTitle>
              <DialogDescription>{t.dialogHint}</DialogDescription>
            </DialogHeader>

            {editing !== "new" && editing !== null && (
              <input type="hidden" name="id" value={editing.id} />
            )}

            <div className="flex flex-col gap-4 py-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="flex flex-col gap-1 text-sm">
                  <span className="font-medium">{t.name}</span>
                  <Input
                    name="name"
                    defaultValue={editing !== "new" && editing !== null ? editing.name : ""}
                    maxLength={120}
                    required
                  />
                </label>

                <label className="flex flex-col gap-1 text-sm">
                  <span className="font-medium">{t.key}</span>
                  <Input
                    name="key"
                    dir="ltr"
                    className="font-mono text-xs"
                    defaultValue={editing !== "new" && editing !== null ? editing.key : ""}
                    /* Locked once it exists: the key is what a seed, an import
                       and a support call name the role by. */
                    readOnly={editing !== "new"}
                    required={editing === "new"}
                    maxLength={64}
                  />
                  {editing !== "new" && (
                    <span className="text-xs text-muted-foreground">{t.keyLocked}</span>
                  )}
                </label>
              </div>

              <fieldset className="flex flex-col gap-1">
                <legend className="text-sm font-medium">{t.tier}</legend>
                <p className="mb-1 text-xs text-muted-foreground">{t.tierHint}</p>
                <div className="flex flex-wrap gap-3">
                  {tiers.map((tier) => (
                    <label key={tier.value} className="flex items-center gap-2 text-sm">
                      <input
                        type="radio"
                        name="tier"
                        value={tier.value}
                        defaultChecked={
                          editing !== "new" && editing !== null
                            ? String(editing.tier) === tier.value
                            : tier === tiers[0]
                        }
                      />
                      {tier.label}
                    </label>
                  ))}
                </div>
              </fieldset>

              <fieldset className="flex flex-col gap-3">
                <legend className="text-sm font-semibold">{t.capabilities}</legend>
                <div className="grid gap-3 sm:grid-cols-1">
                  {groups.map((group) => (
                    <div
                      key={group}
                      className="flex flex-col gap-2 rounded-xl border border-border/70 bg-card/60 p-3.5 shadow-2xs"
                    >
                      <p className="text-xs font-bold text-primary flex items-center gap-1.5">
                        <span className="flex size-1.5 rounded-full bg-primary" />
                        {group}
                      </p>
                      <div className="grid gap-2 sm:grid-cols-2">
                        {capabilities
                          .filter((one) => one.group === group)
                          .map((one) => (
                            <label
                              key={one.key}
                              className={cn(
                                "flex items-start gap-2.5 rounded-lg border border-border/40 bg-background/80 p-2.5 transition-colors",
                                one.grantable
                                  ? "hover:border-primary/40 hover:bg-primary/5 cursor-pointer"
                                  : "opacity-60 cursor-not-allowed",
                              )}
                            >
                              <Checkbox
                                name="capability"
                                value={one.key}
                                defaultChecked={
                                  editing !== "new" && editing !== null
                                    ? editing.capabilities.includes(
                                        one.key as RoleView["capabilities"][number],
                                      )
                                    : false
                                }
                                disabled={!one.grantable}
                                className="mt-0.5"
                              />
                              <span className="flex flex-col gap-0.5 min-w-0">
                                <span className="text-xs font-bold text-foreground">
                                  {one.name}
                                </span>
                                <span className="text-[11px] leading-relaxed text-muted-foreground">
                                  {one.what}
                                </span>
                              </span>
                            </label>
                          ))}
                      </div>
                    </div>
                  ))}
                </div>
              </fieldset>
            </div>

            <Feedback
              result={
                lastSaveTarget === (editing === "new" ? "new" : editing?.id) ? saveResult : null
              }
              t={t}
            />

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEditing(null)}>
                {t.cancel}
              </Button>
              <Button type="submit" disabled={saving}>
                {t.save}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ── Deleting ────────────────────────────────────────────────────── */}
      <Dialog open={confirming !== null} onOpenChange={(open) => !open && setConfirming(null)}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>{t.deleteTitle?.replace("{name}", confirming?.name ?? "")}</DialogTitle>
            <DialogDescription>
              {(confirming?.holders ?? 0) > 0
                ? count(t.deleteBlocked, confirming?.holders ?? 0, locale)
                : t.deleteBody}
            </DialogDescription>
          </DialogHeader>
          <Feedback result={lastRemoveId === confirming?.id ? removeResult : null} t={t} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirming(null)}>
              {t.cancel}
            </Button>
            <Button
              variant="destructive"
              disabled={removing || (confirming?.holders ?? 0) > 0}
              onClick={() => {
                const form = new FormData();
                const id = confirming?.id ?? "";
                form.set("id", id);
                setLastRemoveId(id);
                startTransition(() => submitRemove(form));
              }}
            >
              {t.delete}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
