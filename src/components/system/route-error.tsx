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

export function RouteError({ reset }: { reset: () => void }) {
  const t = useTranslations("boundary");
  return (
    <div className="mx-auto flex min-h-[40dvh] w-full max-w-3xl items-center justify-center px-4 py-10">
      <Empty className="w-full border border-dashed">
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
    </div>
  );
}
