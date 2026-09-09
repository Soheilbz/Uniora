"use client";

import { usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { RegisterColumn } from "./register-view-types.ts";

const MIN_WIDTH = 88;
const MAX_WIDTH = 640;
const DEFAULT_WIDTH = 160;

interface StoredPreferences {
  widths?: Record<string, number>;
  pinned?: string[];
}

function boundedWidth(value: unknown): number | null {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, Math.round(numeric)));
}

function storageKey(pathname: string): string {
  return `univ-web:register-layout:v2:${pathname}`;
}

export function useRegisterTablePreferences(columns: readonly RegisterColumn[]) {
  const pathname = usePathname();
  const [widths, setWidths] = useState<Record<string, number>>({});
  const [pinned, setPinnedState] = useState<ReadonlySet<string>>(new Set());
  const [hydratedKey, setHydratedKey] = useState<string | null>(null);
  const known = useMemo(() => new Set(columns.map((column) => column.key)), [columns]);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(storageKey(pathname));
      if (!raw) {
        setWidths({});
        setPinnedState(new Set());
        setHydratedKey(pathname);
        return;
      }
      const parsed = JSON.parse(raw) as StoredPreferences;
      const nextWidths: Record<string, number> = {};
      for (const [key, value] of Object.entries(parsed.widths ?? {})) {
        const width = boundedWidth(value);
        if (known.has(key) && width !== null) nextWidths[key] = width;
      }
      setWidths(nextWidths);
      setPinnedState(new Set((parsed.pinned ?? []).filter((key) => known.has(key))));
      setHydratedKey(pathname);
    } catch {
      /* A malformed browser preference is disposable UI state, not a broken register. */
      setWidths({});
      setPinnedState(new Set());
      setHydratedKey(pathname);
    }
  }, [known, pathname]);

  useEffect(() => {
    if (hydratedKey !== pathname) return;
    try {
      const payload: StoredPreferences = { widths, pinned: [...pinned] };
      window.localStorage.setItem(storageKey(pathname), JSON.stringify(payload));
    } catch {
      /* Private browsing/storage quotas must never make the register unusable. */
    }
  }, [hydratedKey, pathname, pinned, widths]);

  const setWidth = useCallback((key: string, width: number) => {
    const safe = boundedWidth(width);
    if (safe === null) return;
    setWidths((current) => ({ ...current, [key]: safe }));
  }, []);

  const togglePinned = useCallback((key: string, next?: boolean) => {
    setPinnedState((current) => {
      const updated = new Set(current);
      const shouldPin = next ?? !updated.has(key);
      if (shouldPin) updated.add(key);
      else updated.delete(key);
      return updated;
    });
  }, []);

  const reset = useCallback(() => {
    setWidths({});
    setPinnedState(new Set());
  }, []);

  const widthFor = useCallback(
    (column: RegisterColumn) => widths[column.key] ?? column.defaultWidth ?? DEFAULT_WIDTH,
    [widths],
  );

  return { widths, pinned, setWidth, togglePinned, reset, widthFor };
}
