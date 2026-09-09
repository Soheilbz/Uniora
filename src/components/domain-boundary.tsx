"use client";

import { AlertTriangle, LoaderCircle, RotateCcw } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";

export function DomainLoading() {
  return (
    <div
      className="flex min-h-[45vh] items-center justify-center px-6"
      role="status"
      aria-live="polite"
    >
      <div className="flex flex-col items-center gap-3 text-center text-muted-foreground">
        <LoaderCircle className="size-6 animate-spin" aria-hidden />
        <div className="space-y-2">
          <div className="mx-auto h-3 w-40 animate-pulse rounded bg-muted" />
          <div className="mx-auto h-3 w-64 max-w-[70vw] animate-pulse rounded bg-muted" />
        </div>
        <span className="sr-only">Loading</span>
      </div>
    </div>
  );
}

export function DomainError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations("boundary");

  useEffect(() => {
    // The error object is intentionally not rendered. Server logs/tracing own
    // technical detail; a tenant-facing page must not leak SQL, paths or ids.
    console.error("route boundary", { digest: error.digest, name: error.name });
  }, [error]);

  return (
    <div className="flex min-h-[45vh] items-center justify-center px-6">
      <div className="max-w-lg rounded-xl border bg-card p-6 text-center shadow-sm">
        <AlertTriangle className="mx-auto size-8 text-warning" aria-hidden />
        <h1 className="mt-3 text-lg font-semibold">{t("errorTitle")}</h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">{t("errorBody")}</p>
        <Button className="mt-4" onClick={reset}>
          <RotateCcw className="size-4" aria-hidden />
          {t("retry")}
        </Button>
      </div>
    </div>
  );
}
