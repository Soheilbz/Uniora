"use client";

import { Printer, UserPlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { Feedback } from "@/components/settings/profile-forms";
import {
  type UserDirectoryActions,
  useUserDirectory,
} from "@/components/settings/use-user-directory";
import {
  ConfirmDialog,
  CreateDialog,
  LifecycleDialog,
  PasswordDialog,
  RolesDialog,
  SuspendDialog,
} from "@/components/settings/user-directory-dialogs";
import { UserDirectoryRow } from "@/components/settings/user-directory-row";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { MAX_SEARCH_LENGTH } from "@/lib/input-limits.ts";
import type { RoleChoice, UserRow } from "@/modules/settings/user-queries.ts";

function number(value: number, locale: string): string {
  return new Intl.NumberFormat(locale === "fa" ? "fa-IR" : "en-US").format(value);
}

/* The last-sign-in column, in the calendar and clock the office works in.
   Built once here rather than per row per render — a directory page renders
   both the value and its hover detail for every account listed. */
function lastLoginFormatter(locale: string, timeZone: string, withTime = false) {
  return new Intl.DateTimeFormat(locale === "fa" ? "fa-IR" : "en-US", {
    dateStyle: "short",
    ...(withTime ? { timeStyle: "short" as const } : {}),
    timeZone,
  });
}

export function UserDirectory({
  users,
  totalUsers,
  roles,
  actions,
  t,
  locale,
  timeZone,
  passwordMinLength,
  initialSearch = "",
}: {
  users: UserRow[];
  totalUsers: number;
  roles: RoleChoice[];
  actions: UserDirectoryActions;
  t: Record<string, string>;
  locale: string;
  timeZone: string;
  passwordMinLength: number;
  initialSearch?: string;
}) {
  const router = useRouter();
  const lastLogin = lastLoginFormatter(locale, timeZone);
  const lastLoginFull = lastLoginFormatter(locale, timeZone, true);
  const {
    assignable,
    filteredUsers,
    lastAction,
    open,
    pending,
    post,
    result,
    search,
    setOpen,
    setSearch,
  } = useUserDirectory({
    users,
    roles,
    actions,
    initialSearch,
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold">{t.title}</h2>
          <Badge
            variant="outline"
            className="text-xs font-mono font-semibold text-muted-foreground"
          >
            {(t.userCount ?? "{count}").replace("{count}", number(totalUsers, locale))}
          </Badge>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {/* Quick Search */}
          <div className="w-full max-w-60">
            <Input
              type="search"
              maxLength={MAX_SEARCH_LENGTH}
              placeholder={t.searchPlaceholder}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter") return;
                const params = new URLSearchParams();
                if (search.trim()) params.set("q", search.trim());
                router.push(`/settings/users${params.size ? `?${params.toString()}` : ""}`);
              }}
              className="h-8.5 text-xs placeholder:text-muted-foreground/70"
            />
          </div>

          <Button
            variant="outline"
            size="sm"
            nativeButton={false}
            render={
              <a href="/print/users" target="_blank" rel="noreferrer">
                <Printer className="size-4" aria-hidden />
                {t.print}
              </a>
            }
          />
          <Button size="sm" onClick={() => setOpen({ kind: "create" })}>
            <UserPlus className="size-4" aria-hidden />
            {t.add}
          </Button>
        </div>
      </div>

      <div className="rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t.columnAccount}</TableHead>
              <TableHead className="w-56">{t.columnAccess}</TableHead>
              <TableHead className="w-40">{t.columnStanding}</TableHead>
              <TableHead className="w-36">{t.columnLastLogin}</TableHead>
              <TableHead className="w-32">{t.columnDevices}</TableHead>
              <TableHead className="w-40" aria-label={t.editUser ?? ""}>
                <span className="sr-only">{t.editUser}</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredUsers.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
                  {t.empty}
                </TableCell>
              </TableRow>
            )}

            {filteredUsers.map((row) => (
              <UserDirectoryRow
                key={row.id}
                row={row}
                t={t}
                locale={locale}
                pending={pending}
                lastLogin={lastLogin}
                lastLoginFull={lastLoginFull}
                onOpen={(value) => setOpen(value)}
              />
            ))}
          </TableBody>
        </Table>
      </div>

      <Feedback result={result} t={t} />

      {/*
       * A revoked account explains itself under the table rather than in a
       * tooltip: it is the one state nobody can undo, and somebody looking at
       * the row is usually asking whether they can.
       */}
      {users.some((row) => row.standing === "revoked") && (
        <p className="max-w-[45rem] text-xs leading-relaxed text-muted-foreground">
          {t.revokedNote}
        </p>
      )}

      <CreateDialog
        open={open?.kind === "create"}
        onClose={() => setOpen(null)}
        roles={assignable}
        pending={pending}
        result={lastAction === "create" ? result : null}
        onSubmit={(fields) => post("create", fields)}
        t={t}
        passwordMinLength={passwordMinLength}
      />

      <RolesDialog
        open={open?.kind === "roles" ? open.user : null}
        onClose={() => setOpen(null)}
        roles={roles}
        pending={pending}
        result={lastAction === "assignRoles" ? result : null}
        onSubmit={(userId, chosen) => post("assignRoles", { userId, role: chosen })}
        t={t}
      />

      <PasswordDialog
        open={open?.kind === "password" ? open.user : null}
        onClose={() => setOpen(null)}
        pending={pending}
        result={lastAction === "resetPassword" ? result : null}
        onSubmit={(userId, password) => post("resetPassword", { userId, password })}
        t={t}
        passwordMinLength={passwordMinLength}
      />

      <LifecycleDialog
        open={open?.kind === "lifecycle" ? open.user : null}
        onClose={() => setOpen(null)}
        pending={pending}
        result={lastAction === "lifecycle" ? result : null}
        onSubmit={(fields) => post("lifecycle", fields)}
        t={t}
      />

      <SuspendDialog
        open={open?.kind === "suspend" ? open.user : null}
        onClose={() => setOpen(null)}
        pending={pending}
        result={lastAction === "suspend" ? result : null}
        onSubmit={(userId, reason) => post("suspend", { userId, reason })}
        t={t}
        locale={locale}
      />

      <ConfirmDialog
        open={open?.kind === "reinstate" ? open.user : null}
        onClose={() => setOpen(null)}
        pending={pending}
        result={lastAction === "reinstate" ? result : null}
        title={t.reinstateTitle ?? ""}
        body={t.reinstateBody ?? ""}
        confirm={t.reinstate ?? ""}
        onConfirm={(user) => post("reinstate", { userId: user.id })}
        t={t}
        locale={locale}
      />

      <ConfirmDialog
        open={open?.kind === "revoke" ? open.user : null}
        onClose={() => setOpen(null)}
        pending={pending}
        result={lastAction === "revoke" ? result : null}
        title={t.revokeTitle ?? ""}
        body={`${t.revokeBody ?? ""} ${t.revokeVsSuspend ?? ""}`.trim()}
        confirm={t.revoke ?? ""}
        destructive
        onConfirm={(user) => post("revoke", { userId: user.id })}
        t={t}
        locale={locale}
      />

      <ConfirmDialog
        open={open?.kind === "signOut" ? open.user : null}
        onClose={() => setOpen(null)}
        pending={pending}
        result={lastAction === "signOut" ? result : null}
        title={t.signOutTitle ?? ""}
        body={t.signOutBody ?? ""}
        confirm={t.signOut ?? ""}
        onConfirm={(user) => post("signOut", { userId: user.id })}
        t={t}
        locale={locale}
      />
    </div>
  );
}
