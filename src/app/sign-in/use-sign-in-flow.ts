"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useRef, useState, useTransition } from "react";
import { authClient } from "@/lib/auth-client";
import {
  canonicalAuthUsername,
  canonicalPlatformUsername,
  isValidLocalUsername,
  isValidTenantSlug,
} from "@/lib/auth-username";
import type { SignInFieldErrors, SignInLabels, SsoProvider } from "./types";

export function useSignInFlow({
  labels,
  platformMode,
  successPath,
}: {
  labels: SignInLabels;
  platformMode: boolean;
  successPath: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<SignInFieldErrors>({});
  const [capsLock, setCapsLock] = useState(false);
  const [ssoProviders, setSsoProviders] = useState<SsoProvider[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const alertRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setHydrated(true);
    if (error) alertRef.current?.focus();
  }, [error]);

  function completeLogin() {
    router.refresh();
    router.replace(successPath);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const form = new FormData(event.currentTarget);
    const tenant = String(form.get("tenant") ?? "")
      .trim()
      .toLowerCase();
    const username = String(form.get("username") ?? "")
      .trim()
      .toLowerCase();
    const password = String(form.get("password") ?? "");
    const remember = form.get("remember") === "on";
    setError(null);

    const next: SignInFieldErrors = {};
    if (!platformMode) {
      if (!tenant) next.tenant = labels.tenantRequired;
      else if (!isValidTenantSlug(tenant)) next.tenant = labels.failed;
    }
    if (!username) next.username = labels.usernameRequired;
    else if (!isValidLocalUsername(username)) next.username = labels.failed;
    if (!password) next.password = labels.passwordRequired;
    setFieldErrors(next);
    if (next.tenant || next.username || next.password) {
      document
        .getElementById(
          next.tenant ? "login-tenant" : next.username ? "login-username" : "login-password",
        )
        ?.focus();
      return;
    }

    startTransition(async () => {
      try {
        const result = await authClient.signIn.username({
          username: platformMode
            ? canonicalPlatformUsername(username)
            : canonicalAuthUsername(tenant, username),
          password,
          rememberMe: remember,
        });
        if (result.error) {
          const err = result.error as { status?: number } | null;
          setError(err?.status === 429 ? labels.tooManyAttempts : labels.failed);
          return;
        }
        completeLogin();
      } catch {
        setError(labels.unreachable);
      }
    });
  }

  function signInWithPasskey() {
    if (pending) return;
    setError(null);
    startTransition(async () => {
      try {
        const result = await authClient.signIn.passkey();
        if (result.error) return setError(labels.passkeyFailed);
        completeLogin();
      } catch {
        setError(labels.unreachable);
      }
    });
  }

  function discoverSso() {
    if (pending || platformMode) return;
    const tenantInput = document.getElementById("login-tenant") as HTMLInputElement | null;
    const tenant = tenantInput?.value.trim().toLowerCase() ?? "";
    setError(null);
    if (!isValidTenantSlug(tenant)) {
      setFieldErrors((current) => ({ ...current, tenant: labels.tenantRequired }));
      tenantInput?.focus();
      return;
    }
    startTransition(async () => {
      try {
        const response = await fetch(
          `/api/public/sso/providers?tenant=${encodeURIComponent(tenant)}`,
          { cache: "no-store", headers: { Accept: "application/json" } },
        );
        if (!response.ok) return setError(labels.ssoFailed);
        const payload = (await response.json()) as { providers?: SsoProvider[] };
        const providers = Array.isArray(payload.providers) ? payload.providers : [];
        if (providers.length === 0) {
          setSsoProviders([]);
          return setError(labels.ssoUnavailable);
        }
        if (providers.length === 1) {
          const provider = providers[0];
          if (provider) await signInWithSso(provider.providerId);
          return;
        }
        setSsoProviders(providers.slice(0, 8));
      } catch {
        setError(labels.unreachable);
      }
    });
  }

  async function signInWithSso(providerId: string) {
    try {
      const result = await authClient.signIn.sso({ providerId, callbackURL: successPath });
      if (result?.error) setError(labels.ssoFailed);
    } catch {
      setError(labels.unreachable);
    }
  }

  function clearFieldError(field: keyof SignInFieldErrors) {
    setFieldErrors((current) => {
      if (!current[field]) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
  }

  return {
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
  };
}
