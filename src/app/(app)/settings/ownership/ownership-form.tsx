"use client";

import { useActionState, useState } from "react";
import { Feedback } from "@/components/settings/profile-forms";
import { SettingRow, SettingsCard } from "@/components/settings/setting-row";
import { Button } from "@/components/ui/button";
import type { ActionResult } from "@/lib/register/action-result";
import type { OwnershipCandidate } from "@/modules/settings/ownership-queries";

interface OwnershipWords {
  title: string;
  subtitle: string;
  transfer: string;
  current: string;
  ownerOnly: string;
  newOwner: string;
  noCandidates: string;
  confirmTitle: string;
  confirmBody: string;
  confirmAction: string;
  cancel: string;
  invalidOwner: string;
  ownerTransferred: string;
  saveFailed: string;
}

export function OwnershipForm({
  candidates,
  owner,
  action,
  t,
}: {
  candidates: OwnershipCandidate[];
  owner: boolean;
  action: (p: ActionResult | null, f: FormData) => Promise<ActionResult>;
  t: OwnershipWords;
}) {
  const [result, submit, pending] = useActionState(action, null);
  const [selectedId, setSelectedId] = useState("");
  const [confirming, setConfirming] = useState(false);
  const current = candidates.find((one) => one.current);
  const alternatives = candidates.filter((one) => !one.current);
  const selected = alternatives.find((one) => one.id === selectedId);
  const feedbackWords: Record<string, string> = {
    invalidOwner: t.invalidOwner,
    ownerTransferred: t.ownerTransferred,
    saveFailed: t.saveFailed,
  };

  return (
    <form action={submit} className="space-y-4">
      <SettingsCard
        title={t.title}
        description={t.subtitle}
        actions={
          owner && alternatives.length > 0 && !confirming ? (
            <Button
              type="button"
              disabled={pending || !selectedId}
              onClick={() => setConfirming(true)}
            >
              {t.transfer}
            </Button>
          ) : undefined
        }
      >
        <div className="space-y-3 py-2 text-sm">
          <p>
            <span className="text-muted-foreground">{t.current}: </span>
            <strong>{current?.name ?? "—"}</strong>
            {current?.username ? (
              <span className="ms-2 font-mono text-xs" dir="ltr">
                {current.username}
              </span>
            ) : null}
          </p>
          {owner ? (
            alternatives.length > 0 ? (
              <SettingRow
                label={t.newOwner}
                htmlFor="ownership-user"
                fluidControl
                control={
                  <select
                    id="ownership-user"
                    name="userId"
                    required
                    value={selectedId}
                    onChange={(event) => {
                      setSelectedId(event.target.value);
                      setConfirming(false);
                    }}
                    className="h-10 w-full rounded-md border bg-background px-3"
                  >
                    <option value="" disabled>
                      —
                    </option>
                    {alternatives.map((one) => (
                      <option key={one.id} value={one.id}>
                        {one.name}
                        {one.username ? ` (${one.username})` : ""}
                      </option>
                    ))}
                  </select>
                }
              />
            ) : (
              <p className="text-muted-foreground">{t.noCandidates}</p>
            )
          ) : (
            <p className="text-muted-foreground">{t.ownerOnly}</p>
          )}

          {owner && confirming && selected ? (
            <div
              className="rounded-lg border border-destructive/40 bg-destructive/5 p-3"
              role="alert"
              aria-labelledby="ownership-confirm-title"
            >
              <p id="ownership-confirm-title" className="font-semibold text-foreground">
                {t.confirmTitle}
              </p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                {t.confirmBody.replaceAll("{name}", selected.name)}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button type="submit" variant="destructive" disabled={pending}>
                  {t.confirmAction}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={pending}
                  onClick={() => setConfirming(false)}
                >
                  {t.cancel}
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      </SettingsCard>
      <Feedback result={result} t={feedbackWords} />
    </form>
  );
}
