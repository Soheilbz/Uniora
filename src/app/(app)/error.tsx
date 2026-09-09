"use client";

import { RotateCcw, TriangleAlert } from "lucide-react";
import { useTranslations } from "next-intl";
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
 * The segment's catch for a render that threw.
 *
 * Without this file a fault anywhere below the layout — a read that came back
 * malformed, a query the pool never answered — falls through to Next's own
 * error screen: English, left-to-right, and worded for a developer rather than
 * for a clerk at a university. In a Persian RTL product that screen is itself
 * the bug.
 *
 * It is deliberately careful about data. A render boundary cannot prove what
 * happened immediately before the render failed, so the message gives a
 * recovery path without making an assurance about persistence it cannot know.
 */
export default function AppError({ reset }: { reset: () => void }) {
  const t = useTranslations("boundary");

  return (
    <PageBody>
      <Empty className="border border-dashed">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <TriangleAlert aria-hidden />
          </EmptyMedia>
          <h1 data-slot="empty-title" className="font-heading text-sm font-medium tracking-normal">
            {t("errorTitle")}
          </h1>
          <EmptyDescription>{t("errorBody")}</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button onClick={reset}>
            <RotateCcw aria-hidden />
            {t("retry")}
          </Button>
        </EmptyContent>
      </Empty>
    </PageBody>
  );
}
