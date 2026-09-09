"use client";

import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DatePicker } from "@/components/ui/date-picker";
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
import type { RoleChoice, UserRow } from "@/modules/settings/user-queries.ts";

function localizedCount(template: string | undefined, value: number, locale: string): string {
  const formatted = new Intl.NumberFormat(locale === "fa" ? "fa-IR" : "en-US").format(value);
  return (template ?? "").replace("{count}", formatted);
}

export function CreateDialog({
  open,
  onClose,
  roles,
  pending,
  result,
  onSubmit,
  t,
  passwordMinLength,
}: {
  open: boolean;
  onClose: () => void;
  roles: RoleChoice[];
  pending: boolean;
  result: ActionResult | null;
  onSubmit: (fields: Record<string, string | string[]>) => void;
  t: Record<string, string>;
  passwordMinLength: number;
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent showCloseButton={false}>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            onSubmit({
              name: String(data.get("name") ?? ""),
              username: String(data.get("username") ?? ""),
              password: String(data.get("password") ?? ""),
              role: data.getAll("role").map(String),
            });
          }}
        >
          <DialogHeader>
            <DialogTitle>{t.add}</DialogTitle>
            <DialogDescription>{t.addHint}</DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-3 py-4">
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">{t.fullName}</span>
              <Input name="name" required maxLength={120} />
              {result?.errors?.name && (
                <span className="text-xs text-destructive">{t[result.errors.name]}</span>
              )}
            </label>

            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">{t.username}</span>
              <Input name="username" dir="ltr" required maxLength={64} className="font-mono" />
              {result?.errors?.username && (
                <span className="text-xs text-destructive">{t[result.errors.username]}</span>
              )}
            </label>

            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">{t.password}</span>
              <Input
                name="password"
                type="password"
                required
                minLength={passwordMinLength}
                maxLength={128}
                autoComplete="new-password"
              />
              <span className="text-xs text-muted-foreground">{t.passwordHint}</span>
              {result?.errors?.password && (
                <span className="text-xs text-destructive">{t[result.errors.password]}</span>
              )}
            </label>

            <fieldset className="flex flex-col gap-2">
              <legend className="text-sm font-medium">{t.roles}</legend>
              {roles.map((role) => (
                <label key={role.id} className="flex items-center gap-2 text-sm">
                  <Checkbox name="role" value={role.id} />
                  {role.name}
                </label>
              ))}
            </fieldset>
          </div>

          <DialogFeedback result={result} t={t} />

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t.cancel}
            </Button>
            <Button type="submit" disabled={pending}>
              <Plus className="size-4" aria-hidden />
              {t.add}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function RolesDialog({
  open,
  onClose,
  roles,
  pending,
  result,
  onSubmit,
  t,
}: {
  open: UserRow | null;
  onClose: () => void;
  roles: RoleChoice[];
  pending: boolean;
  result: ActionResult | null;
  onSubmit: (userId: string, chosen: string[]) => void;
  t: Record<string, string>;
}) {
  return (
    <Dialog open={open !== null} onOpenChange={(next) => !next && onClose()}>
      <DialogContent showCloseButton={false}>
        <form
          key={open?.id ?? "closed"}
          onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            onSubmit(open?.id ?? "", data.getAll("role").map(String));
          }}
        >
          <DialogHeader>
            <DialogTitle>{t.assignRoles}</DialogTitle>
            <DialogDescription>{open?.name}</DialogDescription>
          </DialogHeader>

          <fieldset className="flex flex-col gap-2 py-4">
            {roles.map((role) => (
              <label key={role.id} className="flex items-start gap-2 text-sm">
                <Checkbox
                  name="role"
                  value={role.id}
                  defaultChecked={open?.roleIds.includes(role.id)}
                  /* A role at or above the viewer's own tier cannot be handed
                     out — refused on the server too, which is the control. */
                  disabled={!role.assignable}
                  className="mt-0.5"
                />
                <span className="flex flex-col">
                  {role.name}
                  {!role.assignable && (
                    <span className="text-xs text-muted-foreground">{t.beyondYourLevel}</span>
                  )}
                </span>
              </label>
            ))}
          </fieldset>

          <DialogFeedback result={result} t={t} />

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t.cancel}
            </Button>
            <Button type="submit" disabled={pending}>
              {t.save}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function PasswordDialog({
  open,
  onClose,
  pending,
  result,
  onSubmit,
  t,
  passwordMinLength,
}: {
  open: UserRow | null;
  onClose: () => void;
  pending: boolean;
  result: ActionResult | null;
  onSubmit: (userId: string, password: string) => void;
  t: Record<string, string>;
  passwordMinLength: number;
}) {
  return (
    <Dialog open={open !== null} onOpenChange={(next) => !next && onClose()}>
      <DialogContent showCloseButton={false}>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            onSubmit(open?.id ?? "", String(data.get("password") ?? ""));
          }}
        >
          <DialogHeader>
            <DialogTitle>{t.resetPassword}</DialogTitle>
            <DialogDescription>{open?.name}</DialogDescription>
          </DialogHeader>

          <label className="flex flex-col gap-1 py-4 text-sm">
            <span className="font-medium">{t.newPassword}</span>
            <Input
              name="password"
              type="password"
              required
              minLength={passwordMinLength}
              maxLength={128}
              autoComplete="new-password"
            />
            <span className="text-xs text-muted-foreground">{t.resetHint}</span>
            {result?.errors?.password && (
              <span className="text-xs text-destructive">{t[result.errors.password]}</span>
            )}
          </label>

          <DialogFeedback result={result} t={t} />

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t.cancel}
            </Button>
            <Button type="submit" disabled={pending}>
              {t.save}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function LifecycleDialog({
  open,
  onClose,
  pending,
  result,
  onSubmit,
  t,
}: {
  open: UserRow | null;
  onClose: () => void;
  pending: boolean;
  result: ActionResult | null;
  onSubmit: (fields: Record<string, string>) => void;
  t: Record<string, string>;
}) {
  const expiry = open?.accountExpiresAt
    ? new Date(open.accountExpiresAt).toISOString().slice(0, 10)
    : "";
  return (
    <Dialog open={open !== null} onOpenChange={(next) => !next && onClose()}>
      <DialogContent showCloseButton={false}>
        <form
          key={open?.id ?? "closed"}
          onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            onSubmit({
              userId: open?.id ?? "",
              employmentStart: String(data.get("employmentStart") ?? ""),
              employmentEnd: String(data.get("employmentEnd") ?? ""),
              accountExpiryDate: String(data.get("accountExpiryDate") ?? ""),
            });
          }}
        >
          <DialogHeader>
            <DialogTitle>{t.lifecycle}</DialogTitle>
            <DialogDescription>{open?.name}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 py-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1 text-sm">
              <span className="font-medium">{t.employmentStart}</span>
              <DatePicker
                name="employmentStart"
                defaultValue={open?.employmentStart ?? ""}
                ariaLabel={t.employmentStart}
                ariaInvalid={Boolean(result?.errors?.employmentStart)}
                ariaDescribedBy={
                  result?.errors?.employmentStart ? "employment-start-error" : undefined
                }
              />
              {result?.errors?.employmentStart ? (
                <span id="employment-start-error" role="alert" className="text-xs text-destructive">
                  {t[result.errors.employmentStart]}
                </span>
              ) : null}
            </div>
            <div className="flex flex-col gap-1 text-sm">
              <span className="font-medium">{t.employmentEnd}</span>
              <DatePicker
                name="employmentEnd"
                defaultValue={open?.employmentEnd ?? ""}
                ariaLabel={t.employmentEnd}
                ariaInvalid={Boolean(result?.errors?.employmentEnd)}
                ariaDescribedBy={result?.errors?.employmentEnd ? "employment-end-error" : undefined}
              />
              {result?.errors?.employmentEnd ? (
                <span id="employment-end-error" role="alert" className="text-xs text-destructive">
                  {t[result.errors.employmentEnd]}
                </span>
              ) : null}
            </div>
            <div className="flex flex-col gap-1 text-sm sm:col-span-2">
              <span className="font-medium">{t.accountExpiry}</span>
              <DatePicker
                name="accountExpiryDate"
                defaultValue={expiry}
                ariaLabel={t.accountExpiry}
                ariaInvalid={Boolean(result?.errors?.accountExpiryDate)}
                ariaDescribedBy={
                  result?.errors?.accountExpiryDate
                    ? "account-expiry-hint account-expiry-error"
                    : "account-expiry-hint"
                }
              />
              <span id="account-expiry-hint" className="text-xs text-muted-foreground">
                {t.accountExpiryHint}
              </span>
              {result?.errors?.accountExpiryDate ? (
                <span id="account-expiry-error" role="alert" className="text-xs text-destructive">
                  {t[result.errors.accountExpiryDate]}
                </span>
              ) : null}
            </div>
          </div>
          <DialogFeedback result={result} t={t} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t.cancel}
            </Button>
            <Button type="submit" disabled={pending}>
              {t.save}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function SuspendDialog({
  open,
  onClose,
  pending,
  result,
  onSubmit,
  t,
  locale,
}: {
  open: UserRow | null;
  onClose: () => void;
  pending: boolean;
  result: ActionResult | null;
  onSubmit: (userId: string, reason: string) => void;
  t: Record<string, string>;
  locale: string;
}) {
  return (
    <Dialog open={open !== null} onOpenChange={(next) => !next && onClose()}>
      <DialogContent showCloseButton={false}>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            onSubmit(open?.id ?? "", String(data.get("reason") ?? ""));
          }}
        >
          <DialogHeader>
            <DialogTitle>{t.suspendTitle?.replace("{name}", open?.name ?? "")}</DialogTitle>
            <DialogDescription>
              {localizedCount(t.suspendBody, open?.devices ?? 0, locale)}
            </DialogDescription>
          </DialogHeader>

          <label className="flex flex-col gap-1 py-4 text-sm">
            <span className="font-medium">{t.suspendReason}</span>
            <Input name="reason" maxLength={200} />
            <span className="text-xs text-muted-foreground">{t.suspendReasonHint}</span>
            {result?.errors?.reason && (
              <span className="text-xs text-destructive">{t[result.errors.reason]}</span>
            )}
          </label>

          <DialogFeedback result={result} t={t} />

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t.cancel}
            </Button>
            <Button type="submit" variant="destructive" disabled={pending}>
              {t.suspend}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DialogFeedback({ result, t }: { result: ActionResult | null; t: Record<string, string> }) {
  if (!result || result.ok || !result.message) return null;
  return (
    <p role="alert" className="text-sm text-destructive">
      {t[result.message] ?? result.message}
    </p>
  );
}

export function ConfirmDialog({
  open,
  onClose,
  pending,
  result,
  title,
  body,
  confirm,
  onConfirm,
  t,
  locale,
  destructive = false,
}: {
  open: UserRow | null;
  onClose: () => void;
  pending: boolean;
  result: ActionResult | null;
  title: string;
  body: string;
  confirm: string;
  onConfirm: (user: UserRow) => void;
  t: Record<string, string>;
  locale: string;
  destructive?: boolean;
}) {
  const interpolate = (template: string) =>
    localizedCount(template, open?.devices ?? 0, locale).replace("{name}", open?.name ?? "");

  return (
    <Dialog open={open !== null} onOpenChange={(next) => !next && onClose()}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{interpolate(title)}</DialogTitle>
          <DialogDescription>{interpolate(body)}</DialogDescription>
        </DialogHeader>
        <DialogFeedback result={result} t={t} />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t.cancel}
          </Button>
          <Button
            variant={destructive ? "destructive" : "default"}
            disabled={pending}
            onClick={() => open && onConfirm(open)}
          >
            {confirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
