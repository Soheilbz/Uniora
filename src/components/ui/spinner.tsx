"use client";

import { Loader2Icon } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

function Spinner({ className, ...props }: React.ComponentProps<"svg">) {
  const loading = useTranslations("common")("loading");
  return (
    <Loader2Icon
      data-slot="spinner"
      role="status"
      aria-label={loading}
      className={cn("size-4 animate-spin", className)}
      {...props}
    />
  );
}

export { Spinner };
