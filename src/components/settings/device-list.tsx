"use client";

import { Globe, Laptop, Monitor, Smartphone } from "lucide-react";
import { useActionState, useTransition } from "react";
import { Feedback } from "@/components/settings/profile-forms";
import { SettingsCard } from "@/components/settings/setting-row";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { ActionResult } from "@/lib/register/action-result.ts";

export interface DeviceRow {
  id: string;
  current: boolean;
  since: string;
  agent: string | null;
  address: string | null;
}

/**
 * Everywhere this account is signed in, and a way to close one.
 *
 * The point of the list is the row somebody does not recognise. So each says
 * where it signed in from and when — a list of five identical «مرورگر» lines is
 * a list nobody can act on — and the one being read is marked, because
 * otherwise the safe move is to close none of them.
 */
export function DeviceList({
  devices,
  action,
  t,
}: {
  devices: DeviceRow[];
  action: (previous: ActionResult | null, form: FormData) => Promise<ActionResult>;
  t: Record<string, string>;
}) {
  const [result, revoke, pending] = useActionState(action, null);
  const [, startTransition] = useTransition();

  return (
    <>
      <SettingsCard title={t.sessionsTitle ?? ""} description={t.sessionsSubtitle}>
        {devices.length === 0 ? (
          <p className="py-2 text-sm text-muted-foreground">{t.noSessions}</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 pt-1">
            {devices.map((device) => {
              const Icon = getDeviceIcon(device.agent);
              return (
                <div
                  key={device.id}
                  className="flex flex-wrap sm:flex-nowrap items-center justify-between gap-3 rounded-xl border border-border/70 bg-card/60 p-3.5 shadow-2xs transition-colors hover:border-primary/40 hover:bg-primary/5"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-border/60 bg-muted/40 text-primary shadow-2xs">
                      <Icon className="size-4.5" aria-hidden />
                    </div>
                    <div className="flex min-w-0 flex-col gap-0.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate text-xs font-bold text-foreground" dir="ltr">
                          {describe(device.agent) ?? t.unknownDevice}
                        </span>
                        {device.current && (
                          <Badge
                            variant="outline"
                            className="ui-state-success px-2 py-0 text-[10px] font-bold"
                          >
                            {t.currentDevice}
                          </Badge>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                        <span>{device.since}</span>
                        {device.address && (
                          <>
                            <span>·</span>
                            <span dir="ltr" className="numeric font-mono text-[10px]">
                              {device.address}
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  {!device.current && (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={pending}
                      className="h-8 text-xs shrink-0 hover:bg-destructive/10 hover:text-destructive hover:border-destructive/30 transition-colors ms-auto"
                      onClick={() => {
                        const form = new FormData();
                        form.set("id", device.id);
                        startTransition(() => revoke(form));
                      }}
                    >
                      {t.signOutDevice}
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </SettingsCard>
      <Feedback result={result} t={t} />
    </>
  );
}

function getDeviceIcon(agent: string | null) {
  if (!agent) return Globe;
  if (/Android|iPhone|iPad/i.test(agent)) return Smartphone;
  if (/Macintosh|Windows|Linux/i.test(agent)) return Laptop;
  return Monitor;
}

/**
 * A user-agent string as something a person recognises.
 *
 * Deliberately crude: browser and platform, nothing else. The full string is
 * ninety characters of version numbers, and the question being asked of this
 * list is "was that me, on my own machine" — which «Firefox · Windows» answers
 * and «Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0)…» does not.
 */
function describe(agent: string | null): string | null {
  if (!agent) return null;

  const browser = /Edg\//.test(agent)
    ? "Edge"
    : /OPR\//.test(agent)
      ? "Opera"
      : /Chrome\//.test(agent)
        ? "Chrome"
        : /Firefox\//.test(agent)
          ? "Firefox"
          : /Safari\//.test(agent)
            ? "Safari"
            : null;

  const platform = /Android/.test(agent)
    ? "Android"
    : /iPhone|iPad/.test(agent)
      ? "iOS"
      : /Mac OS X/.test(agent)
        ? "macOS"
        : /Windows/.test(agent)
          ? "Windows"
          : /Linux/.test(agent)
            ? "Linux"
            : null;

  const parts = [browser, platform].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : null;
}
