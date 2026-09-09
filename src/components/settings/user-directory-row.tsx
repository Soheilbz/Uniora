"use client";

import type { LucideIcon } from "lucide-react";
import { CalendarClock, KeyRound, LogOut, ShieldCheck, ShieldOff, UserX } from "lucide-react";
import type { UserDirectoryOpen } from "@/components/settings/use-user-directory";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TableCell, TableRow } from "@/components/ui/table";
import type { UserRow } from "@/modules/settings/user-queries";

interface UserDirectoryRowProps {
  row: UserRow;
  t: Record<string, string>;
  locale: string;
  pending: boolean;
  lastLogin: Intl.DateTimeFormat;
  lastLoginFull: Intl.DateTimeFormat;
  onOpen: (value: Exclude<UserDirectoryOpen, null>) => void;
}

export function UserDirectoryRow({
  row,
  t,
  locale,
  pending,
  lastLogin,
  lastLoginFull,
  onOpen,
}: UserDirectoryRowProps) {
  const label = (key: string) => t[key] ?? key;
  return (
    <TableRow className="transition-colors hover:bg-muted/40">
      <TableCell>
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-xs font-bold text-foreground">
            {row.name
              .split(/\s+/)
              .slice(0, 2)
              .map((part) => part[0] ?? "")
              .join("")}
          </div>
          <div className="flex min-w-0 flex-col items-start gap-1">
            <span className="max-w-full break-words text-sm font-bold leading-5 text-foreground">
              {row.name}
            </span>
            <span
              className="numeric max-w-full truncate font-mono text-xs text-muted-foreground"
              dir="ltr"
            >
              {row.username ?? "—"}
            </span>
            {row.self && (
              <Badge
                variant="outline"
                className="w-fit bg-muted/40 px-1.5 py-0 text-[10px] font-normal text-muted-foreground"
              >
                {t.selfHint}
              </Badge>
            )}
          </div>
        </div>
      </TableCell>

      <TableCell>
        {row.roleNames.length === 0 ? (
          <span className="text-xs text-muted-foreground">{t.noRoles}</span>
        ) : (
          <div className="flex flex-wrap gap-1">
            {row.roleNames.map((name) => (
              <Badge key={name} variant="secondary" className="px-2 py-0.5 text-xs font-medium">
                {name}
              </Badge>
            ))}
          </div>
        )}
      </TableCell>

      <TableCell>
        <div className="flex flex-col gap-1">
          <Badge
            variant="outline"
            className={
              row.standing === "active"
                ? "ui-state-success w-fit text-[11px] font-semibold"
                : row.standing === "scheduled" ||
                    row.standing === "suspended" ||
                    row.standing === "expired"
                  ? "ui-state-warning w-fit text-[11px] font-semibold"
                  : "ui-state-danger w-fit text-[11px] font-semibold"
            }
          >
            {t[`standing.${row.standing}`]}
          </Badge>
          {row.standing === "suspended" && (
            <span className="text-[11px] text-muted-foreground">
              {row.suspendedReason || t.suspendedNoReason}
            </span>
          )}
        </div>
      </TableCell>

      <TableCell>
        {row.lastLoginAt ? (
          <span
            className="numeric text-xs text-muted-foreground"
            title={lastLoginFull.format(new Date(row.lastLoginAt))}
          >
            {lastLogin.format(new Date(row.lastLoginAt))}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">{t.neverLoggedIn}</span>
        )}
      </TableCell>

      <TableCell className="text-xs font-medium text-foreground">
        {row.devices === 0 ? (
          <span className="text-muted-foreground">{t.noDevices}</span>
        ) : (
          localizedCount(t.devices, row.devices, locale)
        )}
      </TableCell>

      <TableCell>
        {row.actionable ? (
          <div className="flex items-center justify-end gap-1">
            <ActionButton
              label={label("assignRoles")}
              name={row.name}
              disabled={pending || row.standing === "revoked"}
              onClick={() => onOpen({ kind: "roles", user: row })}
              icon={ShieldCheck}
            />
            <ActionButton
              label={label("resetPassword")}
              name={row.name}
              disabled={pending || row.standing === "revoked"}
              onClick={() => onOpen({ kind: "password", user: row })}
              icon={KeyRound}
            />
            <ActionButton
              label={label("lifecycle")}
              name={row.name}
              disabled={pending || row.standing === "revoked"}
              onClick={() => onOpen({ kind: "lifecycle", user: row })}
              icon={CalendarClock}
            />
            <ActionButton
              label={label("signOut")}
              name={row.name}
              disabled={pending || row.devices === 0 || row.standing === "revoked"}
              onClick={() => onOpen({ kind: "signOut", user: row })}
              icon={LogOut}
            />
            <ActionButton
              label={label("revoke")}
              name={row.name}
              disabled={pending || row.standing === "revoked"}
              onClick={() => onOpen({ kind: "revoke", user: row })}
              icon={UserX}
              destructive
            />
            {row.standing === "active" ? (
              <ActionButton
                label={label("suspend")}
                name={row.name}
                disabled={pending}
                onClick={() => onOpen({ kind: "suspend", user: row })}
                icon={ShieldOff}
                destructive
              />
            ) : row.standing === "suspended" ? (
              <Button
                variant="outline"
                size="sm"
                className="h-7 border-success-subtle-border px-2 text-xs text-success-subtle-foreground hover:bg-success-subtle"
                disabled={pending}
                onClick={() => onOpen({ kind: "reinstate", user: row })}
              >
                {t.reinstate}
              </Button>
            ) : null}
          </div>
        ) : (
          <span className="block text-end text-xs text-muted-foreground">
            {row.self ? t.selfHint : t.outranksYou}
          </span>
        )}
      </TableCell>
    </TableRow>
  );
}

function ActionButton({
  label,
  name,
  disabled,
  onClick,
  icon: Icon,
  destructive = false,
}: {
  label: string;
  name: string;
  disabled: boolean;
  onClick: () => void;
  icon: LucideIcon;
  destructive?: boolean;
}) {
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={`${label} — ${name}`}
      title={label}
      disabled={disabled}
      onClick={onClick}
    >
      <Icon
        className={
          destructive
            ? "size-4 text-muted-foreground hover:text-destructive"
            : "size-4 text-muted-foreground hover:text-foreground"
        }
        aria-hidden
      />
    </Button>
  );
}

function localizedCount(template: string | undefined, value: number, locale: string): string {
  const formatted = new Intl.NumberFormat(locale === "fa" ? "fa-IR" : "en-US").format(value);
  return (template ?? "").replace("{count}", formatted);
}
