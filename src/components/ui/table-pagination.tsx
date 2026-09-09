import type * as React from "react";

import { cn } from "@/lib/utils";

/** The single visual shell used below every paginated data table. */
export function TablePagination({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="table-pagination"
      data-print-hide
      className={cn(
        "flex min-h-14 shrink-0 flex-wrap items-center justify-between gap-3 rounded-xl border border-border/80 bg-card/95 px-3 py-2.5 shadow-2xs backdrop-blur-xs",
        className,
      )}
      {...props}
    />
  );
}
