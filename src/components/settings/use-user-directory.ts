"use client";

import { useActionState, useEffect, useMemo, useState, useTransition } from "react";
import type { ActionResult } from "@/lib/register/action-result";
import type { RoleChoice, UserRow } from "@/modules/settings/user-queries";

export type UserDirectoryAction = (
  previous: ActionResult | null,
  form: FormData,
) => Promise<ActionResult>;
export interface UserDirectoryActions {
  create: UserDirectoryAction;
  assignRoles: UserDirectoryAction;
  suspend: UserDirectoryAction;
  reinstate: UserDirectoryAction;
  revoke: UserDirectoryAction;
  signOut: UserDirectoryAction;
  resetPassword: UserDirectoryAction;
  lifecycle: UserDirectoryAction;
}
export type UserDirectoryOpen =
  | { kind: "create" }
  | {
      kind: "roles" | "suspend" | "reinstate" | "revoke" | "signOut" | "password" | "lifecycle";
      user: UserRow;
    }
  | null;

export function useUserDirectory({
  users,
  roles,
  actions,
  initialSearch,
}: {
  users: UserRow[];
  roles: RoleChoice[];
  actions: UserDirectoryActions;
  initialSearch: string;
}) {
  const [result, run, pending] = useActionState(
    async (previous: ActionResult | null, form: FormData) => {
      const which = String(form.get("__action") ?? "");
      const action = actions[which as keyof UserDirectoryActions];
      return action ? action(previous, form) : { ok: false, message: "saveFailed" };
    },
    null,
  );
  const [, startTransition] = useTransition();
  const [open, setOpen] = useState<UserDirectoryOpen>(null);
  const [lastAction, setLastAction] = useState<keyof UserDirectoryActions | null>(null);
  const [search, setSearch] = useState(initialSearch);

  const post = (which: keyof UserDirectoryActions, fields: Record<string, string | string[]>) => {
    const form = new FormData();
    form.set("__action", which);
    setLastAction(which);
    for (const [key, value] of Object.entries(fields)) {
      for (const one of Array.isArray(value) ? value : [value]) form.append(key, one);
    }
    startTransition(() => run(form));
  };

  useEffect(() => {
    if (result?.ok) setOpen(null);
  }, [result]);

  const assignable = useMemo(() => roles.filter((role) => role.assignable), [roles]);
  const filteredUsers = useMemo(() => {
    const q = fold(search.trim());
    if (!q) return users;
    return users.filter(
      (user) =>
        fold(user.name).includes(q) ||
        (user.username ? fold(user.username).includes(q) : false) ||
        user.roleNames.some((role) => fold(role).includes(q)),
    );
  }, [search, users]);

  return {
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
  };
}

function fold(value: string): string {
  return value
    .toLocaleLowerCase("fa-IR")
    .replace(/[يى]/g, "ی")
    .replace(/ك/g, "ک")
    .replace(/\s+/g, " ")
    .trim();
}
