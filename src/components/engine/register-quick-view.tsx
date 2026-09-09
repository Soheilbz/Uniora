"use client";

import { ExternalLink } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type { RegisterColumn, RegisterViewRow } from "./register-view-types.ts";

export function RegisterQuickView({
  row,
  columns,
  open,
  onOpenChange,
  words,
}: {
  row: RegisterViewRow | null;
  columns: RegisterColumn[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  words: { title: string; openRecord: string; empty: string };
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-[min(92vw,34rem)] overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{row?.label || words.title}</SheetTitle>
          <SheetDescription>{words.title}</SheetDescription>
        </SheetHeader>
        {row ? (
          <div className="grid gap-3 px-4 pb-6">
            {columns.map((column) => {
              const cell = row.cells[column.key];
              const primary = cell?.text ?? cell?.list?.filter(Boolean).join("، ") ?? null;
              const value = [primary, cell?.secondary].filter(Boolean).join(" · ");
              return (
                <div key={column.key} className="rounded-lg border bg-muted/20 p-3">
                  <dt className="text-xs font-medium text-muted-foreground">{column.header}</dt>
                  <dd className="mt-1 whitespace-pre-wrap text-sm">{value || words.empty}</dd>
                </div>
              );
            })}
            {row.href ? (
              <Button
                nativeButton={false}
                render={
                  <Link href={row.href}>
                    <ExternalLink aria-hidden />
                    {words.openRecord}
                  </Link>
                }
              />
            ) : null}
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
