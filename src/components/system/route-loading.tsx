import { getTranslations } from "next-intl/server";

export async function RouteLoading() {
  const t = await getTranslations("common");
  return (
    <div
      className="flex min-h-[40dvh] flex-col items-center justify-center gap-3"
      role="status"
      aria-live="polite"
    >
      <div
        className="size-8 animate-spin rounded-full border-2 border-muted-foreground/25 border-t-foreground"
        aria-hidden
      />
      <p className="text-sm text-muted-foreground">{t("loading")}</p>
    </div>
  );
}
