"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Keep the server-rendered job list current while a worker owns active jobs. */
export function ExportJobsRefresh({ active }: { active: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => router.refresh(), 5000);
    return () => window.clearInterval(timer);
  }, [active, router]);
  return null;
}
