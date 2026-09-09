"use client";

import { Trash2, Users } from "lucide-react";
import { useTranslations } from "next-intl";
import { useActionState, useEffect, useState } from "react";
import { toast } from "sonner";
import { CouncilDirectoryCombobox } from "@/components/council/directory-combobox";
import { ToolbarButton } from "@/components/engine/toolbar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ActionResult } from "@/lib/register/action-result.ts";
import type { DirectoryEntry, RosterSeat } from "@/modules/council/roster.ts";

/**
 * The people invited to every sitting.
 *
 * A dialog rather than a page, because it is a list of nineteen names that is
 * edited twice a year and read every fortnight — it belongs beside the register
 * it seeds, not behind a navigation of its own.
 *
 * A seat carries the directory row it belongs to wherever there is one. A roster
 * typed by hand says «دکتر موسوي» while the directory says «موسوی», and every
 * attendance list seeded from it inherits the spelling; the link is what lets a
 * seated member be counted. It is optional because the council seats an
 * education-office representative and a graduate-studies officer who hold no
 * professorship.
 */
export function RosterDialog({
  seats,
  directory,
  addAction,
  removeAction,
}: {
  seats: RosterSeat[];
  directory: DirectoryEntry[];
  addAction: (previous: ActionResult | null, form: FormData) => Promise<ActionResult>;
  removeAction: (previous: ActionResult | null, form: FormData) => Promise<ActionResult>;
}) {
  const t = useTranslations("council");
  const common = useTranslations("common");
  /* Rootless, so an action can hand back any catalogue path — `errors.required`
     or `council.roster.duplicate` — and this renders it without knowing which
     namespace it came from. */
  const say = useTranslations();
  const [open, setOpen] = useState(false);
  const [selectedProfessorId, setSelectedProfessorId] = useState<string | null>(null);
  const [memberName, setMemberName] = useState("");
  const [added, add, adding] = useActionState(addAction, null);
  const [removed, remove, removing] = useActionState(removeAction, null);

  const selectedProfessor = directory.find((person) => person.id === selectedProfessorId);
  const nameError = added?.errors?.memberName;

  useEffect(() => {
    if (removed && !removed.ok) {
      toast.error(removed.message ? say(removed.message) : common("formSaveFailed"));
    }
  }, [removed, say, common]);

  useEffect(() => {
    if (!added?.ok) return;
    setSelectedProfessorId(null);
    setMemberName("");
  }, [added]);

  return (
    <div className="inline-flex">
      <ToolbarButton icon={<Users className="size-4" aria-hidden />} onClick={() => setOpen(true)}>
        {t("permanentMembers")}
      </ToolbarButton>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent showCloseButton={false} className="sm:max-w-3xl md:max-w-4xl p-6">
          <DialogHeader className="border-b border-border/40 pb-3">
            <DialogTitle className="text-base font-bold text-foreground">
              {t("roster.title")}
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              {t("roster.hint")}
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 pt-1">
            {/* Left/Main Column: Existing Standing Members List */}
            <div className="flex flex-col gap-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-foreground">
                  {t("permanentMembers")} ({seats.length})
                </span>
              </div>

              {seats.length === 0 ? (
                <p className="rounded-xl border border-dashed border-border/80 p-8 text-center text-xs text-muted-foreground">
                  {t("roster.empty")}
                </p>
              ) : (
                <ul className="flex max-h-80 flex-col divide-y divide-border/40 overflow-y-auto rounded-xl border border-border/80 bg-muted/10 p-1">
                  {seats.map((seat) => (
                    <li
                      key={seat.id}
                      className="flex items-center justify-between gap-2 p-2.5 transition-colors hover:bg-card/80 rounded-lg"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-bold text-foreground">
                          {seat.memberName}
                        </p>
                      </div>
                      <form action={remove}>
                        <input type="hidden" name="id" value={seat.id} />
                        <Button
                          type="submit"
                          variant="ghost"
                          size="icon-xs"
                          disabled={removing}
                          aria-label={`${t("roster.remove")} — ${seat.memberName}`}
                          className="text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                        >
                          <Trash2 className="size-3.5" aria-hidden />
                        </Button>
                      </form>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Right Column: Add Permanent Member by selecting a Professor */}
            <div className="flex flex-col justify-between rounded-xl border border-border/80 bg-card/70 p-4 shadow-2xs">
              <form action={add} className="flex flex-col gap-4">
                <div className="flex flex-col gap-1">
                  <span className="text-xs font-bold text-foreground">{t("roster.add")}</span>
                  <p className="text-xs text-muted-foreground">{t("roster.linkHint")}</p>
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="professorSelect" className="text-xs font-semibold">
                    {t("roster.link")}
                  </Label>
                  <CouncilDirectoryCombobox
                    id="professorSelect"
                    name="professorId"
                    value={selectedProfessorId ?? ""}
                    onChange={(val) => setSelectedProfessorId(val || null)}
                    onEntrySelect={(professor) => {
                      if (professor) setMemberName(professor.name);
                    }}
                    initialEntries={directory}
                    excludeIds={seats.flatMap((seat) =>
                      seat.professorId ? [seat.professorId] : [],
                    )}
                    placeholder={t("roster.link")}
                    allowCustom={false}
                  />

                  <Label htmlFor="memberName" className="mt-2 text-xs font-semibold">
                    {t("roster.name")}
                  </Label>
                  <Input
                    id="memberName"
                    name="memberName"
                    value={selectedProfessor?.name ?? memberName}
                    onChange={(event) => {
                      setSelectedProfessorId(null);
                      setMemberName(event.target.value);
                    }}
                    maxLength={200}
                    required
                    aria-invalid={nameError ? true : undefined}
                  />

                  {nameError && (
                    <p id="memberName-error" className="text-xs text-destructive">
                      {say(nameError)}
                    </p>
                  )}
                </div>

                <Button
                  type="submit"
                  size="sm"
                  disabled={adding || (selectedProfessorId === null && memberName.trim() === "")}
                  className="h-9 font-semibold shadow-xs"
                >
                  {t("roster.add")}
                </Button>
              </form>

              <div className="flex justify-end pt-4 border-t border-border/40 mt-4">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setOpen(false)}
                  className="h-8 text-xs"
                >
                  {common("close")}
                </Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
