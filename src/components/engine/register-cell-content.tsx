"use client";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { GenderMark, NamePanel } from "./register-view-cells";
import type { RegisterCell } from "./register-view-types.ts";
import { STATUS_TONES, TONES } from "./tones.ts";

export function RegisterCellContent({ cell }: { cell: RegisterCell | undefined }) {
  return (
    <div className="flex min-w-0 w-full flex-col items-start text-start">
      {cell?.list || cell?.distinct ? (
        <NamePanel list={cell.list ?? []} distinct={cell.distinct ?? null} />
      ) : cell?.badges ? (
        <div className="flex min-w-0 w-full flex-col gap-1.5 items-start text-start">
          {cell.badges.map((badge) => (
            <div
              key={`${badge.text}-${badge.tone}-${badge.caption ?? ""}`}
              className="min-w-0 w-full"
            >
              <Badge
                variant="outline"
                className={cn(
                  "max-w-full rounded-md px-2 py-0.5 text-xs font-semibold shadow-2xs whitespace-normal break-words",
                  STATUS_TONES[badge.tone],
                )}
              >
                {badge.text}
              </Badge>
              {badge.caption ? (
                <p className="mt-1 text-xs text-muted-foreground break-words text-wrap leading-relaxed">
                  {badge.caption}
                </p>
              ) : null}
            </div>
          ))}
        </div>
      ) : cell?.statusTone && cell.text ? (
        <Badge
          variant="outline"
          className={cn(
            "max-w-full rounded-md px-2 py-0.5 text-xs font-medium shadow-2xs whitespace-normal break-words",
            STATUS_TONES[cell.statusTone],
          )}
        >
          {cell.text}
        </Badge>
      ) : cell?.tone !== undefined && cell.text ? (
        <Badge
          variant="outline"
          className={cn(
            "max-w-full rounded-md px-2 py-0.5 text-xs font-medium shadow-2xs whitespace-normal break-words",
            TONES[cell.tone % TONES.length],
          )}
        >
          {cell.text}
        </Badge>
      ) : cell?.gender ? (
        <span className="flex min-w-0 items-center gap-1.5">
          <GenderMark value={cell.gender.value} label={cell.gender.label} />
          <span className="font-medium text-foreground text-xs break-words text-wrap">
            {cell.text ?? "—"}
          </span>
        </span>
      ) : cell?.ltr ? (
        <span
          dir="ltr"
          className="numeric max-w-full break-all whitespace-normal text-xs font-semibold text-foreground text-start"
        >
          {cell.text ?? "—"}
        </span>
      ) : (
        <span
          className={cn(
            "text-xs font-medium text-foreground break-words text-wrap leading-relaxed",
            !cell?.text && "font-normal text-muted-foreground",
            cell?.muted && "text-xs font-normal text-muted-foreground",
            cell?.clamp && "line-clamp-2",
          )}
        >
          {cell?.text ?? "—"}
        </span>
      )}
      {cell?.secondary ? (
        <span
          {...(cell.ltr ? { dir: "ltr" } : {})}
          className={cn(
            "text-xs text-muted-foreground mt-0.5 break-words text-wrap leading-relaxed",
            cell.ltr && "numeric max-w-full break-all whitespace-normal text-start font-normal",
          )}
        >
          {cell.secondary}
        </span>
      ) : null}
    </div>
  );
}
