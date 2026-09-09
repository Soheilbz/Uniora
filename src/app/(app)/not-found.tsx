import { FileQuestion } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { PageBody } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
} from "@/components/ui/empty";

/**
 * The segment's answer to `notFound()`.
 *
 * Every record page calls it when the id in the URL resolves to nothing —
 * retired, deleted, or simply mistyped. Without this file those calls render
 * Next's stock 404, untranslated and outside the application shell, leaving
 * the reader with the browser's back button as their only way out.
 */
export default async function AppNotFound() {
  const t = await getTranslations("boundary");

  return (
    <PageBody>
      <Empty className="border border-dashed">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <FileQuestion aria-hidden />
          </EmptyMedia>
          <h1 data-slot="empty-title" className="font-heading text-sm font-medium tracking-normal">
            {t("notFoundTitle")}
          </h1>
          <EmptyDescription>{t("notFoundBody")}</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          {/* `nativeButton={false}` because this renders an anchor — see the
              forbidden page for why Base UI needs to be told. */}
          <Button nativeButton={false} render={<Link href="/">{t("notFoundBack")}</Link>} />
        </EmptyContent>
      </Empty>
    </PageBody>
  );
}
