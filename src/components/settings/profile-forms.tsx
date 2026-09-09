"use client";

import { Eye, EyeOff, Lock, User } from "lucide-react";
import { useActionState, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { SettingRow, SettingsCard } from "@/components/settings/setting-row";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ActionResult } from "@/lib/register/action-result.ts";

/**
 * The two things somebody may change about their own account.
 *
 * Client components because both are forms with a result to report, and because
 * a password field must never be re-populated from the server — the value lives
 * here, in the browser, for exactly as long as the submission takes.
 */

export function DisplayNameForm({
  action,
  initial,
  username,
  email,
  t,
}: {
  action: (previous: ActionResult | null, form: FormData) => Promise<ActionResult>;
  initial: string;
  username: string;
  email: string;
  t: Record<string, string>;
}) {
  const [result, submit, pending] = useActionState(action, null);

  return (
    <form action={submit}>
      <SettingsCard
        title={t.title ?? ""}
        description={t.subtitle}
        actions={
          <Button type="submit" disabled={pending} className="px-5 font-semibold">
            {t.save}
          </Button>
        }
      >
        {/* User Identity Avatar Row */}
        <div className="flex items-center gap-4 py-2 border-b border-border/40 mb-2">
          <div className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-primary/10 border border-primary/20 text-foreground text-xl font-bold shadow-2xs">
            {initial ? (
              initial
                .split(/\s+/)
                .slice(0, 2)
                .map((p) => p[0] ?? "")
                .join("")
            ) : (
              <User className="size-6" />
            )}
          </div>
          <div className="flex flex-col gap-0.5 min-w-0">
            <span className="text-sm font-bold text-foreground truncate">
              {initial || username}
            </span>
            <span className="text-xs font-mono text-muted-foreground" dir="ltr">
              {username}
            </span>
          </div>
        </div>

        <SettingRow
          label={t.name ?? ""}
          htmlFor="display-name"
          fluidControl
          control={
            <div className="flex w-full flex-col items-end gap-1">
              <Input
                id="display-name"
                name="name"
                defaultValue={initial}
                maxLength={120}
                required
                className="w-full max-w-none text-xs font-medium"
                aria-invalid={result?.errors?.name ? true : undefined}
              />
              {result?.errors?.name && (
                <span className="text-xs text-destructive">
                  {t[result.errors.name] ?? result.errors.name}
                </span>
              )}
            </div>
          }
        />
        {/*
         * The username is shown and not editable.
         *
         * It is what the audit trail records an action against and what
         * somebody signs in with; changing it is an administrator's act, not
         * the holder's. Hiding it instead would be worse — «با کدام حساب وارد
         * شده‌ام» is a real question on a shared machine.
         */}
        <SettingRow
          label={t.username ?? ""}
          control={
            <span className="numeric text-xs font-mono font-bold text-foreground/90" dir="ltr">
              {username}
            </span>
          }
        />
        <SettingRow
          label={t.email ?? ""}
          control={
            <span className="text-xs text-muted-foreground font-mono" dir="ltr">
              {email || "—"}
            </span>
          }
        />
      </SettingsCard>
      <Feedback result={result} t={t} />
    </form>
  );
}

export function PasswordForm({
  action,
  t,
  minPasswordLength,
}: {
  action: (previous: ActionResult | null, form: FormData) => Promise<ActionResult>;
  t: Record<string, string>;
  minPasswordLength: number;
}) {
  const [result, submit, pending] = useActionState(action, null);
  const formRef = useRef<HTMLFormElement>(null);
  const [attempt, setAttempt] = useState(0);

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  /*
   * A successful change empties the boxes and resets local state.
   */
  useEffect(() => {
    if (result?.ok) {
      formRef.current?.reset();
      setNewPassword("");
      setConfirmPassword("");
      setAttempt((count) => count + 1);
    }
  }, [result]);

  const mismatch = confirmPassword.length > 0 && newPassword !== confirmPassword;

  return (
    <form ref={formRef} action={submit}>
      <SettingsCard
        title={t.passwordTitle ?? ""}
        description={t.passwordSubtitle}
        actions={
          <Button type="submit" disabled={pending || mismatch} className="px-5 font-semibold">
            <Lock className="size-4" aria-hidden />
            {t.changePassword}
          </Button>
        }
      >
        <SettingRow
          key={`currentPassword-${attempt}`}
          label={t.currentPassword ?? ""}
          htmlFor="currentPassword"
          fluidControl
          control={
            <div className="flex w-full flex-col items-end gap-1">
              <div className="relative w-full max-w-none">
                <Input
                  id="currentPassword"
                  name="currentPassword"
                  type={showCurrent ? "text" : "password"}
                  autoComplete="current-password"
                  required
                  className="w-full pe-9 font-mono text-xs"
                  aria-invalid={result?.errors?.currentPassword ? true : undefined}
                />
                <button
                  type="button"
                  onClick={() => setShowCurrent(!showCurrent)}
                  className="absolute end-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground p-1 transition-colors"
                  aria-label={showCurrent ? t.hidePassword : t.showPassword}
                >
                  {showCurrent ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
              {result?.errors?.currentPassword && (
                <span className="text-xs text-destructive">
                  {t[result.errors.currentPassword] ?? result.errors.currentPassword}
                </span>
              )}
            </div>
          }
        />

        <SettingRow
          key={`newPassword-${attempt}`}
          label={t.newPassword ?? ""}
          hint={t.passwordHint}
          htmlFor="newPassword"
          fluidControl
          control={
            <div className="flex w-full flex-col items-end gap-1">
              <div className="relative w-full max-w-none">
                <Input
                  id="newPassword"
                  name="newPassword"
                  type={showNew ? "text" : "password"}
                  autoComplete="new-password"
                  minLength={minPasswordLength}
                  maxLength={128}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  required
                  className="w-full pe-9 font-mono text-xs"
                  aria-invalid={result?.errors?.newPassword ? true : undefined}
                />
                <button
                  type="button"
                  onClick={() => setShowNew(!showNew)}
                  className="absolute end-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground p-1 transition-colors"
                  aria-label={showNew ? t.hidePassword : t.showPassword}
                >
                  {showNew ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
              {result?.errors?.newPassword && (
                <span className="text-xs text-destructive">
                  {t[result.errors.newPassword] ?? result.errors.newPassword}
                </span>
              )}
            </div>
          }
        />

        <SettingRow
          key={`confirmPassword-${attempt}`}
          label={t.confirmPassword ?? ""}
          htmlFor="confirmPassword"
          fluidControl
          control={
            <div className="flex w-full flex-col items-end gap-1">
              <div className="relative w-full max-w-none">
                <Input
                  id="confirmPassword"
                  name="confirmPassword"
                  type={showConfirm ? "text" : "password"}
                  autoComplete="new-password"
                  minLength={minPasswordLength}
                  maxLength={128}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  className="w-full pe-9 font-mono text-xs"
                  aria-invalid={mismatch || !!result?.errors?.confirmPassword}
                />
                <button
                  type="button"
                  onClick={() => setShowConfirm(!showConfirm)}
                  className="absolute end-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground p-1 transition-colors"
                  aria-label={showConfirm ? t.hidePassword : t.showPassword}
                >
                  {showConfirm ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
              {mismatch && <span className="text-xs text-destructive">{t.passwordMismatch}</span>}
              {result?.errors?.confirmPassword && !mismatch && (
                <span className="text-xs text-destructive">
                  {t[result.errors.confirmPassword] ?? result.errors.confirmPassword}
                </span>
              )}
            </div>
          }
        />
      </SettingsCard>
      <Feedback result={result} t={t} />
    </form>
  );
}

/**
 * Reports the result through the shared toast layer so the layout does not
 * jump when a form is saved. Field-level validation remains next to its field.
 */
export function Feedback({
  result,
  t,
}: {
  result: ActionResult | null;
  t: Record<string, string>;
}) {
  useEffect(() => {
    if (!result?.message) return;
    const message = t[result.message] ?? result.message;
    if (result.ok) toast.success(message);
    else toast.error(message);
  }, [result, t]);

  return null;
}
