import type { ReactNode } from "react";
import { Card, CardContent } from "@/components/ui/card";

export function OperationalCard({
  label,
  value,
  detail,
  icon,
  alert,
}: {
  label: string;
  value: string;
  detail: string;
  icon: ReactNode;
  alert?: boolean;
}) {
  return (
    <Card size="sm" className={alert ? "border-amber-500/40" : undefined}>
      <CardContent className="grid gap-2">
        <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>{label}</span>
          <span className={alert ? "text-amber-600 dark:text-amber-400" : "text-primary"}>
            {icon}
          </span>
        </div>
        <p className="truncate text-lg font-semibold numeric" title={value}>
          {value}
        </p>
        <p className="truncate text-[11px] text-muted-foreground" title={detail}>
          {detail}
        </p>
      </CardContent>
    </Card>
  );
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
