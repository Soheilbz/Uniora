"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { interceptedHref } from "./leaving.ts";

export function useUnsavedLeaveGuard(saved: boolean) {
  const router = useRouter();
  const dirty = useRef(false);
  const [leaving, setLeaving] = useState<string | null>(null);

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (!dirty.current) return;
      event.preventDefault();
    };
    const intercept = (event: MouseEvent) => {
      if (!dirty.current || event.defaultPrevented) return;
      const link = (event.target as Element | null)?.closest?.("a");
      const href = interceptedHref(event, link);
      if (href === null) return;
      event.preventDefault();
      setLeaving(href);
    };
    window.addEventListener("beforeunload", warn);
    document.addEventListener("click", intercept, true);
    return () => {
      window.removeEventListener("beforeunload", warn);
      document.removeEventListener("click", intercept, true);
    };
  }, []);

  useEffect(() => {
    if (saved) dirty.current = false;
  }, [saved]);

  const markDirty = useCallback(() => {
    dirty.current = true;
  }, []);
  const stay = useCallback(() => setLeaving(null), []);
  const leave = useCallback(() => {
    const href = leaving;
    dirty.current = false;
    setLeaving(null);
    if (href) router.push(href);
  }, [leaving, router]);

  return { leaving, setLeaving, markDirty, stay, leave };
}
