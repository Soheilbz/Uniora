import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { PendingSubmitButton } from "@/components/pending-submit-button";
import { Input } from "@/components/ui/input";
import { platformNextPath, requirePlatformOperator } from "@/lib/platform-viewer.ts";
import { verifyPlatformMfaChallenge } from "@/modules/platform/security";

export default async function PlatformMfaChallengePage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const operator = await requirePlatformOperator();
  if (!operator.mfaEnabled) redirect("/platform/security/setup");
  const params = await searchParams;
  const next = platformNextPath(params.next ?? "/platform");
  const t = await getTranslations("security");

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-5 p-6">
      <div>
        <h1 className="text-2xl font-bold">{t("challengeTitle")}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{t("challengeHint")}</p>
      </div>
      <form action={verifyPlatformMfaChallenge} className="space-y-3 rounded-xl border p-5">
        <input type="hidden" name="next" value={next} />
        <label className="flex flex-col gap-1 text-sm" htmlFor="platform-mfa-challenge-code">
          <span className="font-medium">{t("codePlaceholder")}</span>
          <Input
            id="platform-mfa-challenge-code"
            name="code"
            inputMode="numeric"
            pattern="[0-9۰-۹٠-٩]{6}"
            maxLength={6}
            required
            dir="ltr"
            autoComplete="one-time-code"
            autoFocus
            aria-invalid={params.error ? true : undefined}
            aria-describedby={params.error ? "platform-mfa-challenge-error" : undefined}
          />
        </label>
        {params.error ? (
          <p id="platform-mfa-challenge-error" role="alert" className="text-sm text-destructive">
            {params.error === "locked" ? t("locked") : t("invalidCode")}
          </p>
        ) : null}
        <PendingSubmitButton className="w-full">{t("verify")}</PendingSubmitButton>
      </form>
    </main>
  );
}
