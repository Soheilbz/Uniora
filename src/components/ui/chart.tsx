"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export type ChartConfig = Record<string, { label?: React.ReactNode; color?: string }>;

const ChartContext = React.createContext<{ config: ChartConfig }>({ config: {} });

export function ChartContainer({
  config,
  className,
  children,
}: React.ComponentProps<"div"> & { config: ChartConfig; children: React.ReactNode }) {
  return (
    <ChartContext.Provider value={{ config }}>
      <div data-slot="chart" className={cn("flex aspect-video justify-center text-xs", className)}>
        {children}
      </div>
    </ChartContext.Provider>
  );
}

export function ChartTooltipContent({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ name?: string; value?: number | string; color?: string }>;
  label?: string | number;
}) {
  const { config } = React.useContext(ChartContext);
  if (!active || !payload?.length) return null;
  return (
    <div className="grid min-w-32 gap-1.5 rounded-lg border border-border/80 bg-popover px-3 py-2 text-xs text-popover-foreground shadow-lg">
      {label !== undefined && <p className="font-semibold">{label}</p>}
      {payload.map((item) => (
        <div key={`${item.name}-${item.value}`} className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <span className="size-2 rounded-full" style={{ backgroundColor: item.color }} />
            {config[item.name ?? ""]?.label ?? item.name}
          </span>
          <span className="numeric font-semibold tabular-nums">{item.value}</span>
        </div>
      ))}
    </div>
  );
}
