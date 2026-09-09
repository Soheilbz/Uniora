import { getTranslations } from "next-intl/server";

/**
 * The segment's loading state.
 *
 * Route transitions between the heavy registers previously had no pending
 * state at all: the old page stayed on screen, frozen, until the new one was
 * fully resolved — which on a cold pool or a wide register reads as a hang.
 * This file gives every navigation a body immediately; it is intentionally
 * structureless rather than a skeleton of the coming page, because a guessed
 * skeleton that mismatches the real layout flickers worse than a plain pulse.
 */
export default async function AppLoading() {
  const t = await getTranslations("common");
  return (
    <div
      className="flex min-h-[50dvh] flex-col items-center justify-center gap-3"
      role="status"
      aria-live="polite"
    >
      <div className="size-8 animate-spin rounded-full border-2 border-muted-foreground/25 border-t-foreground" />
      <p className="text-sm text-muted-foreground">{t("loading")}</p>
    </div>
  );
}
