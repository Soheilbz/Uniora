"use client";

import { useActionState } from "react";
import { PendingSubmitButton } from "@/components/pending-submit-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  beginPlatformMfaEnrollment,
  confirmPlatformMfaEnrollment,
  type PlatformMfaEnrollmentResult,
} from "@/modules/platform/security";

export function PlatformMfaSetup({
  words,
  initialError,
}: {
  words: Record<string, string>;
  initialError?: string | undefined;
}) {
  const [enrollment, begin, pending] = useActionState<PlatformMfaEnrollmentResult | null, FormData>(
    beginPlatformMfaEnrollment,
    null,
  );
  const error = enrollment?.error ?? initialError;

  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center gap-6 p-6">
      <div>
        <h1 className="text-2xl font-bold">{words.setupTitle}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{words.setupRequired}</p>
      </div>
      {!enrollment?.ok ? (
        <form action={begin} className="space-y-4 rounded-xl border p-5">
          <p className="text-sm text-muted-foreground">{words.verifyPasswordHint}</p>
          <label className="flex flex-col gap-1 text-sm" htmlFor="platform-mfa-current-password">
            <span className="font-medium">{words.currentPassword}</span>
            <Input
              id="platform-mfa-current-password"
              name="currentPassword"
              type="password"
              autoComplete="current-password"
              maxLength={128}
              required
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? "platform-mfa-setup-error" : undefined}
            />
          </label>
          {error ? (
            <p id="platform-mfa-setup-error" role="alert" className="text-sm text-destructive">
              {error === "locked"
                ? words.locked
                : error === "passwordWrong"
                  ? words.passwordWrong
                  : error === "passwordRequired"
                    ? words.passwordRequired
                    : words.setupFailed}
            </p>
          ) : null}
          <Button type="submit" disabled={pending} className="w-full">
            {pending ? words.starting : words.start}
          </Button>
        </form>
      ) : (
        <div className="space-y-5 rounded-xl border p-5">
          <div className="flex flex-col items-center gap-3 text-center">
            <p className="text-sm">{words.scanHint}</p>
            {enrollment.qrCodeDataUrl ? (
              /* The data URL is generated server-side from the one-time URI. */
              // biome-ignore lint/performance/noImgElement: QR data URL is generated for this one-time setup flow.
              <img
                src={enrollment.qrCodeDataUrl}
                alt={words.scanHint}
                width={220}
                height={220}
                className="rounded-lg border bg-white p-2"
              />
            ) : null}
          </div>
          <div className="space-y-2">
            <p className="text-sm font-medium">{words.manualKeyLabel}</p>
            <p className="text-xs text-muted-foreground">{words.secretHint}</p>
            <code className="block break-all rounded bg-muted p-3 text-sm" dir="ltr">
              {enrollment.secret}
            </code>
          </div>
          <details className="text-xs text-muted-foreground">
            <summary>{words.uriTitle}</summary>
            <code className="mt-2 block break-all" dir="ltr">
              {enrollment.uri}
            </code>
          </details>
          <form action={confirmPlatformMfaEnrollment} className="space-y-3">
            <label className="flex flex-col gap-1 text-sm" htmlFor="platform-mfa-enrollment-code">
              <span className="font-medium">{words.codePlaceholder}</span>
              <Input
                id="platform-mfa-enrollment-code"
                name="code"
                inputMode="numeric"
                pattern="[0-9۰-۹٠-٩]{6}"
                maxLength={6}
                required
                autoComplete="one-time-code"
                dir="ltr"
                aria-invalid={initialError ? true : undefined}
                aria-describedby={initialError ? "platform-mfa-enrollment-error" : undefined}
              />
            </label>
            {initialError ? (
              <p
                id="platform-mfa-enrollment-error"
                role="alert"
                className="text-sm text-destructive"
              >
                {initialError === "locked" ? words.locked : words.invalidCode}
              </p>
            ) : null}
            <PendingSubmitButton className="w-full">{words.confirm}</PendingSubmitButton>
          </form>
        </div>
      )}
    </main>
  );
}
