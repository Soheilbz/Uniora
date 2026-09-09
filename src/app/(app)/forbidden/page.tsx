import { ShieldAlert } from "lucide-react";
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
import { requireViewer } from "@/lib/viewer";

/**
 * Where a refused permission lands.
 *
 * Inside the application shell, deliberately, and not as a bare error page. The
 * person is signed in and legitimately here — they asked for one screen they may
 * not open, which is an ordinary event in an office where roles differ. Dropping
 * them onto a blank page with no navigation treats a routine refusal as a fault
 * and leaves them with the back button as their only way out.
 *
 * It says nothing about what the screen contains or which permission was
 * missing. "You need `students.nationality`" is a hint about what exists and
 * what to ask for; the sentence here points at the administrator instead, who
 * can see the whole picture and decide.
 */
export async function generateMetadata() {
  /* Named in the browser tab like every other screen. A refusal with the
     application's bare title on it is indistinguishable, in a row of eight open
     tabs, from the screen the person was trying to reach. */
  const t = await getTranslations("forbidden");
  return { title: t("title") };
}

export default async function ForbiddenPage() {
  await requireViewer();
  const t = await getTranslations("forbidden");

  return (
    <PageBody>
      {/* Framed, as the reference frames it: a bordered panel reads as «this is
          the answer», where an unbordered one reads as a page still loading. */}
      <Empty className="border border-dashed">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <ShieldAlert aria-hidden />
          </EmptyMedia>
          {/*
           * A real `h1`, written out rather than routed through `EmptyTitle`.
           *
           * `EmptyTitle` is a `div` with no polymorphic escape, and this is the
           * only heading on the page: without an `h1` the document has no
           * top-level heading at all, and a screen reader reads it as a fragment
           * of something else. `tracking-normal` undoes the primitive's negative
           * letter-spacing, which pulls joined Persian glyphs apart.
           */}
          <h1 data-slot="empty-title" className="font-heading text-sm font-medium tracking-normal">
            {t("title")}
          </h1>
          <EmptyDescription>{t("body")}</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          {/*
           * `nativeButton={false}` because this renders an anchor.
           *
           * Base UI's Button assumes a real `<button>` and, told otherwise,
           * stops adding the keyboard and form behaviour that only makes sense
           * on one — Space-to-activate, participation in a form, the disabled
           * semantics. An anchor has its own, correct set. Without this the
           * component warns and then applies button behaviour to a link, which
           * gives the control two activation stories and one of them wrong.
           */}
          <Button nativeButton={false} render={<Link href="/">{t("back")}</Link>} />
        </EmptyContent>
      </Empty>
    </PageBody>
  );
}
