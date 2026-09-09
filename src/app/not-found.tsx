import { FileQuestion } from "lucide-react";
import { getTranslations } from "next-intl/server";

/**
 * The root's answer to a URL nothing routes to.
 *
 * The `(app)` segment has its own not-found for records that vanished; this
 * one is for paths that never matched a screen at all. Without it those land
 * on Next's stock English 404 — untranslated, directionless, and outside the
 * application's own error language. It is deliberately self-contained (no
 * shell, no links that assume a viewer): an unknown URL is exactly where an
 * unauthenticated stranger may be standing.
 */
export default async function RootNotFound() {
  const t = await getTranslations("boundary");
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 p-8 text-center">
      <FileQuestion aria-hidden className="size-10 text-muted-foreground/50" />
      <h1 className="font-heading text-sm font-medium tracking-normal">{t("notFoundTitle")}</h1>
      <p className="max-w-md text-sm text-muted-foreground">{t("notFoundBody")}</p>
    </main>
  );
}
