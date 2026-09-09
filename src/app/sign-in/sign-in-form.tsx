"use client";

import {
  AlertCircle,
  Building2,
  Eye,
  EyeOff,
  Fingerprint,
  Lock,
  LogIn,
  TriangleAlert,
  User,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import { Spinner } from "@/components/ui/spinner";
import { isValidTenantSlug } from "@/lib/auth-username";
import type { SignInLabels } from "./types";
import { useSignInFlow } from "./use-sign-in-flow";

/**
 * The credential form, and the things it is careful about.
 *
 * ── A wrong password, a throttled network and a dead server are not one failure ─
 *
 * They send a person to three completely different places: one to try again, one
 * to wait a moment, one to find whoever runs the network. Collapsing them into
 * «ورود ناموفق» is how an office spends a morning re-typing a password that was
 * correct. The account lockout stays deliberately indistinguishable from a wrong
 * password — telling somebody their account is locked tells an attacker that the
 * account exists — but the *address-level* throttle answers every account at
 * once, and hiding it would read as a registry that lies.
 *
 * ── Empty fields are refused here, not by the server ──────────────────────────
 *
 * `noValidate` turns off the browser's own bubbles so the messages can be this
 * interface's words, in the reader's language and beside the field they belong
 * to. The price is that nothing enforces `required` — so the form does, before
 * anything leaves the page. An empty submit that round-tripped to the server
 * would come back as «نادرست است», which is false: nothing was wrong; nothing
 * was typed.
 *
 * ── The reveal toggle and the caps-lock notice ────────────────────────────────
 *
 * A password here is a Latin string typed into a right-to-left page, often on a
 * keyboard currently in Persian. Being unable to see what was typed turns one
 * mistyped character into three failed attempts — and this deployment locks an
 * account after five. The same arithmetic is why a caps-lock warning earns its
 * place: the notice costs one line; the lockout costs twenty minutes.
 *
 * ── The labels arrive as props ───────────────────────────────────────────────
 *
 * This is one of the few components that reaches the browser, and passing a
 * dozen strings costs less than shipping a message catalogue to the page a
 * person sees before they are signed in at all.
 */

export function SignInForm({
  labels,
  initialTenant = "",
  platformMode = false,
  successPath = "/",
}: {
  labels: SignInLabels;
  initialTenant?: string;
  platformMode?: boolean;
  successPath?: string;
}) {
  const {
    alertRef,
    capsLock,
    clearFieldError,
    discoverSso,
    error,
    fieldErrors,
    hydrated,
    pending,
    revealed,
    setCapsLock,
    setRevealed,
    signInWithPasskey,
    signInWithSso,
    ssoProviders,
    startTransition,
    submit,
  } = useSignInFlow({ labels, platformMode, successPath });

  return (
    <form
      onSubmit={submit}
      noValidate
      className="login-form"
      data-sign-in-hydrated={hydrated ? "true" : "false"}
    >
      <FieldGroup className="gap-3">
        {/*
         * `role="alert"` and focusable: the refusal is announced, and a second
         * attempt re-announces it because focus moved to it — a screen reader
         * does not rely on catching one live-region instant.
         */}
        {error && (
          <div
            ref={alertRef}
            tabIndex={-1}
            className="rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
          >
            <Alert variant="destructive" role="alert">
              <AlertCircle />
              <AlertTitle>{labels.errorTitle}</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          </div>
        )}

        {/*
         * `InputGroup` owns the padding around its addon, so the icon is
         * declared rather than absolutely positioned over an input given a
         * hand-measured `ps-9` that only holds at one font size.
         *
         * `dir="ltr"` on the control and not the label: a username is a Latin
         * string, and left in the page's direction the caret starts on the
         * wrong side and the text jumps as it is typed.
         */}
        {!platformMode && (
          <Field className="gap-1.5" data-invalid={fieldErrors.tenant ? "true" : undefined}>
            <FieldLabel htmlFor="login-tenant">{labels.tenant}</FieldLabel>
            <InputGroup className="login-input-group" dir="ltr">
              <InputGroupAddon>
                <TriangleAlert className="size-4 opacity-70" aria-hidden />
              </InputGroupAddon>
              <InputGroupInput
                id="login-tenant"
                name="tenant"
                type="text"
                defaultValue={initialTenant}
                autoFocus={!isValidTenantSlug(initialTenant.trim().toLowerCase())}
                autoComplete="organization"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                required
                maxLength={64}
                placeholder={labels.tenantPlaceholder}
                aria-invalid={fieldErrors.tenant ? "true" : undefined}
                aria-describedby={fieldErrors.tenant ? "login-tenant-error" : "login-tenant-hint"}
                onChange={() => clearFieldError("tenant")}
              />
            </InputGroup>
            {fieldErrors.tenant ? (
              <FieldDescription id="login-tenant-error" className="text-destructive">
                {fieldErrors.tenant}
              </FieldDescription>
            ) : (
              <FieldDescription id="login-tenant-hint">{labels.tenantHint}</FieldDescription>
            )}
          </Field>
        )}

        <Field className="gap-1.5" data-invalid={fieldErrors.username ? "true" : undefined}>
          <FieldLabel htmlFor="login-username">{labels.username}</FieldLabel>
          <InputGroup className="login-input-group" dir="ltr">
            <InputGroupAddon>
              <User aria-hidden />
            </InputGroupAddon>
            {/* Focused on mount. This screen has one job, and without it the
                clerk's first keystroke goes nowhere. */}
            <InputGroupInput
              id="login-username"
              name="username"
              type="text"
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              autoFocus={platformMode || isValidTenantSlug(initialTenant.trim().toLowerCase())}
              required
              maxLength={64}
              placeholder={labels.usernamePlaceholder}
              aria-invalid={fieldErrors.username ? "true" : undefined}
              aria-describedby={
                fieldErrors.username ? "login-username-error" : "login-username-hint"
              }
              onChange={() => clearFieldError("username")}
            />
          </InputGroup>
          {fieldErrors.username ? (
            <FieldDescription id="login-username-error" className="text-destructive">
              {fieldErrors.username}
            </FieldDescription>
          ) : (
            <FieldDescription id="login-username-hint">{labels.usernameHint}</FieldDescription>
          )}
        </Field>

        <Field className="gap-1.5">
          <FieldLabel htmlFor="login-password">{labels.password}</FieldLabel>
          <InputGroup className="login-input-group" dir="ltr">
            <InputGroupAddon>
              <Lock aria-hidden />
            </InputGroupAddon>
            {/* No placeholder: it would read «گذرواژه», which is this field's
                own label word for word — nothing to read, and a screen reader
                announcing the field twice. */}
            <InputGroupInput
              id="login-password"
              name="password"
              type={revealed ? "text" : "password"}
              autoComplete="current-password"
              required
              maxLength={128}
              aria-invalid={fieldErrors.password ? "true" : undefined}
              aria-describedby={
                fieldErrors.password ? "login-password-error" : "login-password-hint"
              }
              onKeyUp={(event) => setCapsLock(event.getModifierState?.("CapsLock") ?? false)}
              onKeyDown={(event) => setCapsLock(event.getModifierState?.("CapsLock") ?? false)}
              onBlur={() => setCapsLock(false)}
              onChange={() => clearFieldError("password")}
            />
            {/* `align="inline-end"`: the group knows where the end of the
                control is, in either writing direction and at any font scale. */}
            <InputGroupAddon align="inline-end">
              <InputGroupButton
                type="button"
                aria-label={revealed ? labels.hidePassword : labels.showPassword}
                aria-pressed={revealed}
                onClick={() => setRevealed((previous) => !previous)}
              >
                {revealed ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
              </InputGroupButton>
            </InputGroupAddon>
          </InputGroup>
          {fieldErrors.password ? (
            <FieldDescription id="login-password-error" className="text-destructive">
              {fieldErrors.password}
            </FieldDescription>
          ) : (
            <FieldDescription id="login-password-hint">{labels.passwordHint}</FieldDescription>
          )}
          {/*
           * Caps Lock, said where the eye already is. `getModifierState` is the
           * one reading that survives every layout of every keyboard; the blur
           * clears it so the notice never outlives the field.
           */}
          {capsLock && (
            <FieldDescription className="flex items-center gap-1.5 text-amber-600 dark:text-amber-400">
              <TriangleAlert aria-hidden className="size-3.5" />
              {labels.capsLock}
            </FieldDescription>
          )}
        </Field>

        <Field orientation="horizontal">
          <Checkbox id="login-remember" name="remember" value="on" aria-label={labels.remember} />
          <FieldLabel htmlFor="login-remember" className="font-normal">
            {labels.remember}
          </FieldLabel>
        </Field>
        <FieldDescription className="ps-6">{labels.rememberHint}</FieldDescription>

        <Field className="gap-1.5">
          {/*
           * `disabled` while submitting, and it is the part that matters: a
           * double-click on a slow office network spends two attempts on the
           * same credential, and five failures now slow the account down.
           */}
          <Button
            type="submit"
            size="lg"
            className="login-submit-button w-full transition-colors duration-200"
            disabled={pending}
          >
            {pending ? (
              <>
                <Spinner />
                {labels.submitting}
              </>
            ) : (
              <>
                <LogIn aria-hidden />
                {labels.submit}
              </>
            )}
          </Button>
        </Field>

        <div className="grid gap-2 sm:grid-cols-2">
          <Button type="button" variant="outline" disabled={pending} onClick={signInWithPasskey}>
            <Fingerprint aria-hidden />
            {labels.passkey}
          </Button>
          {!platformMode ? (
            <Button type="button" variant="outline" disabled={pending} onClick={discoverSso}>
              <Building2 aria-hidden />
              {labels.sso}
            </Button>
          ) : null}
        </div>

        {!platformMode && ssoProviders.length > 1 ? (
          <fieldset className="grid gap-2 rounded-lg border bg-muted/20 p-3">
            <legend className="sr-only">{labels.sso}</legend>
            {ssoProviders.map((provider) => (
              <Button
                key={provider.providerId}
                type="button"
                variant="ghost"
                className="justify-start"
                disabled={pending}
                onClick={() => startTransition(() => signInWithSso(provider.providerId))}
              >
                <Building2 aria-hidden />
                <span className="truncate">{provider.name}</span>
              </Button>
            ))}
          </fieldset>
        ) : null}

        {/*
         * No self-service reset exists here — accounts are issued, not
         * registered, and this deployment has no mail server. Saying where the
         * human path runs costs one line; leaving the person at a dead end
         * after a failed attempt costs a phone call to nobody.
         */}
        <p className="text-center text-xs leading-relaxed text-muted-foreground">
          {labels.forgotHint}
        </p>
      </FieldGroup>
    </form>
  );
}
