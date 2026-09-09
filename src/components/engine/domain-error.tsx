"use client";

import { RotateCcw, TriangleAlert } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
} from "@/components/ui/empty";

/** Shared nested-route error state. Never renders raw exception text/digests. */
export function DomainError({ reset }: { reset: () => void }) {
  const t = useTranslations("boundary");
  return (
    <Empty className="min-h-72 border border-dashed">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <TriangleAlert aria-hidden />
        </EmptyMedia>
        <h2 data-slot="empty-title" className="font-heading text-sm font-medium tracking-normal">
          {t("errorTitle")}
        </h2>
        <EmptyDescription>{t("errorBody")}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button type="button" onClick={reset}>
          <RotateCcw aria-hidden />
          {t("retry")}
        </Button>
      </EmptyContent>
    </Empty>
  );
}
