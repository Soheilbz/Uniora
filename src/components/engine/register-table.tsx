"use client";

import { ArrowDown, ArrowUp, ChevronsUpDown, Eye, Pencil, Pin, PinOff, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  useMemo,
  useState,
  useTransition,
} from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { RegisterCellContent } from "./register-cell-content";
import { RegisterQuickView } from "./register-quick-view";
import { useRegisterTablePreferences } from "./register-table-preferences";
import type { RegisterColumn, RegisterViewRow } from "./register-view-types";
import { allSelected, togglePage, toggleRow } from "./table-state";

function rowKeyboardNavigation(event: KeyboardEvent<HTMLTableRowElement>) {
  const keys = ["ArrowDown", "ArrowUp", "Home", "End"];
  if (!keys.includes(event.key)) return false;
  const body = event.currentTarget.parentElement;
  if (!body) return false;
  const rows = [...body.querySelectorAll<HTMLTableRowElement>("tr[data-register-row='true']")];
  const index = rows.indexOf(event.currentTarget);
  if (index < 0) return false;
  const nextIndex =
    event.key === "Home"
      ? 0
      : event.key === "End"
        ? rows.length - 1
        : event.key === "ArrowDown"
          ? Math.min(rows.length - 1, index + 1)
          : Math.max(0, index - 1);
  if (nextIndex === index) return true;
  event.preventDefault();
  rows[nextIndex]?.focus();
  return true;
}

export function RegisterTable({
  columns,
  rows,
  hidden,
  selected,
  setSelected,
  canManage,
  canDelete,
  enableCompare,
  removing,
  onDelete,
  words,
}: {
  columns: RegisterColumn[];
  rows: RegisterViewRow[];
  hidden: ReadonlySet<string>;
  selected: ReadonlySet<string>;
  setSelected: React.Dispatch<React.SetStateAction<ReadonlySet<string>>>;
  canManage: boolean;
  canDelete: boolean;
  enableCompare: boolean;
  removing: boolean;
  onDelete: (row: RegisterViewRow) => void;
  words: {
    edit: string;
    delete: string;
    open: string;
    actions: string;
    selectAll: string;
    selectRow: string;
    quickView: string;
    pin: string;
    unpin: string;
    resizeColumn: (column: string) => string;
    multiSortHint: string;
    empty: string;
  };
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();
  const shown = useMemo(
    () => columns.filter((column) => column.locked || !hidden.has(column.key)),
    [columns, hidden],
  );
  const selectable = canManage || enableCompare;
  const pageIds = rows.map((row) => row.id);
  const allOnPage = allSelected(selected, pageIds);
  const { pinned, setWidth, togglePinned, widthFor } = useRegisterTablePreferences(shown);
  const [quickRow, setQuickRow] = useState<RegisterViewRow | null>(null);

  const offsets = useMemo(() => {
    let offset = selectable ? 44 : 0;
    const map = new Map<string, number>();
    for (const column of shown) {
      if (!pinned.has(column.key)) continue;
      map.set(column.key, offset);
      offset += widthFor(column);
    }
    return map;
  }, [pinned, selectable, shown, widthFor]);

  function pinnedStyle(column: RegisterColumn): CSSProperties | undefined {
    const inset = offsets.get(column.key);
    if (inset === undefined) return undefined;
    return { position: "sticky", insetInlineStart: inset, zIndex: 4, background: "var(--card)" };
  }

  function startResize(event: PointerEvent<HTMLButtonElement>, column: RegisterColumn) {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startWidth = widthFor(column);
    const target = event.currentTarget;
    target.setPointerCapture(event.pointerId);
    const move = (moveEvent: globalThis.PointerEvent) => {
      const direction = document.documentElement.dir === "rtl" ? -1 : 1;
      setWidth(column.key, startWidth + (moveEvent.clientX - startX) * direction);
    };
    const end = (endEvent: globalThis.PointerEvent) => {
      target.releasePointerCapture(endEvent.pointerId);
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", end);
      target.removeEventListener("pointercancel", end);
    };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", end);
    target.addEventListener("pointercancel", end);
  }

  function addSort(event: React.MouseEvent<HTMLAnchorElement>, column: RegisterColumn) {
    if (!event.shiftKey || !column.sortKey || !column.nextSortDirection) return;
    event.preventDefault();
    const params = new URLSearchParams(searchParams.toString());
    const raw = params.get("sorts");
    const sequence: { key: string; direction: "asc" | "desc" }[] = [];
    if (raw) {
      for (const token of raw.split(",").slice(0, 3)) {
        const [key = "", dir = "asc"] = token.split(":", 2);
        if (!key || sequence.some((entry) => entry.key === key)) continue;
        sequence.push({ key, direction: dir === "desc" ? "desc" : "asc" });
      }
    } else {
      const active = columns.find((candidate) => candidate.sortActive && candidate.sortKey);
      if (active?.sortKey)
        sequence.push({ key: active.sortKey, direction: active.sortDirection ?? "asc" });
    }
    const existing = sequence.find((entry) => entry.key === column.sortKey);
    if (existing) existing.direction = column.nextSortDirection;
    else if (sequence.length < 3)
      sequence.push({ key: column.sortKey, direction: column.nextSortDirection });
    if (sequence.length === 0) return;
    const first = sequence[0];
    if (!first) return;
    params.set("sort", first.key);
    params.set("dir", first.direction);
    if (sequence.length > 1)
      params.set("sorts", sequence.map((entry) => `${entry.key}:${entry.direction}`).join(","));
    else params.delete("sorts");
    params.delete("cursor");
    params.delete("page");
    startTransition(() => router.push(`${window.location.pathname}?${params.toString()}`));
  }

  const sortPriorities = useMemo(() => {
    const map = new Map<string, number>();
    const raw = searchParams.get("sorts");
    if (raw)
      raw
        .split(",")
        .slice(0, 3)
        .forEach((token, index) => {
          map.set(token.split(":", 1)[0] ?? "", index + 1);
        });
    return map;
  }, [searchParams]);

  return (
    <>
      <div className="flex w-full min-h-24 min-w-0 flex-1 flex-col md:min-h-0">
        <p className="sr-only" id="register-multisort-hint">
          {words.multiSortHint}
        </p>
        <Table
          containerClassName="min-h-0 !max-h-none flex-1 rounded-xl border border-border/80 bg-card/95 shadow-2xs backdrop-blur-xs"
          className="table-fixed min-w-[52rem]"
          aria-describedby="register-multisort-hint"
        >
          <TableHeader className="sticky top-0 z-10 bg-muted/95 backdrop-blur-[2px] border-b border-border/60 shadow-2xs">
            <TableRow className="hover:bg-transparent border-border/60">
              {selectable ? (
                <TableHead className="sticky start-0 z-20 w-11 min-w-11 bg-muted/95 whitespace-nowrap px-2 py-2 text-center align-middle">
                  <Checkbox
                    checked={allOnPage}
                    aria-label={words.selectAll}
                    onCheckedChange={() => setSelected((current) => togglePage(current, pageIds))}
                  />
                </TableHead>
              ) : null}
              {shown.map((column) => {
                const width = widthFor(column);
                return (
                  <TableHead
                    key={column.key}
                    className={cn(
                      "group relative min-w-0 text-xs font-semibold text-foreground/80 py-2.5 px-3 break-words [overflow-wrap:anywhere]",
                      pinned.has(column.key) && "shadow-[inset_-1px_0_0_var(--border)]",
                    )}
                    style={{ width, minWidth: width, maxWidth: width, ...pinnedStyle(column) }}
                    aria-sort={
                      column.sortActive
                        ? column.sortDirection === "asc"
                          ? "ascending"
                          : "descending"
                        : column.sortHref
                          ? "none"
                          : undefined
                    }
                  >
                    <div className="flex min-w-0 items-center gap-1 pe-2">
                      {column.sortHref ? (
                        <Link
                          href={column.sortHref}
                          onClick={(event) => addSort(event, column)}
                          aria-label={column.sortActionLabel}
                          className={cn(
                            "inline-flex min-w-0 flex-1 items-center gap-1.5 rounded-md outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40",
                            column.sortActive ? "text-primary font-bold" : "text-muted-foreground",
                          )}
                        >
                          <span className="truncate">{column.header}</span>
                          {!column.sortActive ? (
                            <ChevronsUpDown className="size-3.5 shrink-0 opacity-40" aria-hidden />
                          ) : column.sortDirection === "asc" ? (
                            <ArrowUp className="size-3.5 shrink-0 text-primary" aria-hidden />
                          ) : (
                            <ArrowDown className="size-3.5 shrink-0 text-primary" aria-hidden />
                          )}
                          {column.sortKey && sortPriorities.has(column.sortKey) ? (
                            <span className="numeric rounded bg-primary/10 px-1 text-[9px] text-primary">
                              {sortPriorities.get(column.sortKey)}
                            </span>
                          ) : null}
                        </Link>
                      ) : (
                        <span className="min-w-0 flex-1 truncate">{column.header}</span>
                      )}
                      <button
                        type="button"
                        aria-label={`${pinned.has(column.key) ? words.unpin : words.pin} ${column.header}`}
                        aria-pressed={pinned.has(column.key)}
                        className="shrink-0 rounded p-0.5 text-muted-foreground opacity-0 transition hover:bg-muted hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none group-hover:opacity-100"
                        onClick={() => togglePinned(column.key)}
                      >
                        {pinned.has(column.key) ? (
                          <PinOff className="size-3" aria-hidden />
                        ) : (
                          <Pin className="size-3" aria-hidden />
                        )}
                      </button>
                    </div>
                    <button
                      type="button"
                      aria-label={words.resizeColumn(column.header)}
                      className="absolute inset-y-1 end-0 w-2 cursor-col-resize touch-none rounded hover:bg-primary/20 focus-visible:bg-primary/20 focus-visible:outline-none"
                      onPointerDown={(event) => startResize(event, column)}
                    />
                  </TableHead>
                );
              })}
              <TableHead
                aria-label={words.actions}
                className="sticky end-0 z-20 w-28 min-w-28 bg-muted/95 whitespace-nowrap px-2 py-2 text-end align-middle"
              >
                <span className="text-xs font-semibold text-foreground/80">{words.actions}</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody className="divide-y divide-border/40">
            {rows.map((row) => (
              <TableRow
                key={row.id}
                data-register-row="true"
                data-state={selected.has(row.id) ? "selected" : undefined}
                tabIndex={row.href ? 0 : -1}
                aria-label={row.label ?? undefined}
                className={cn(
                  "border-border/40 transition-colors duration-150 data-[state=selected]:bg-primary/5 data-[state=selected]:hover:bg-primary/10 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:relative",
                  row.href && "cursor-pointer hover:bg-muted/40",
                )}
                onClick={() => {
                  const href = row.href;
                  if (!href) return;
                  startTransition(() => router.push(href));
                }}
                onKeyDown={(event) => {
                  if (rowKeyboardNavigation(event)) return;
                  const href = row.href;
                  if (event.key !== "Enter" || !href) return;
                  event.preventDefault();
                  startTransition(() => router.push(href));
                }}
              >
                {selectable ? (
                  <TableCell
                    onClick={(event) => event.stopPropagation()}
                    className="sticky start-0 z-[3] w-11 min-w-11 bg-card whitespace-nowrap px-2 py-2.5 text-center align-middle"
                  >
                    <Checkbox
                      checked={selected.has(row.id)}
                      aria-label={words.selectRow}
                      onCheckedChange={() => setSelected((current) => toggleRow(current, row.id))}
                    />
                  </TableCell>
                ) : null}
                {shown.map((column) => {
                  const width = widthFor(column);
                  return (
                    <TableCell
                      key={column.key}
                      className={cn(
                        "min-w-0 py-2.5 px-3 text-sm align-top overflow-hidden break-words text-wrap [overflow-wrap:anywhere]",
                        pinned.has(column.key) && "shadow-[inset_-1px_0_0_var(--border)]",
                      )}
                      style={{ width, minWidth: width, maxWidth: width, ...pinnedStyle(column) }}
                    >
                      {row.href && column.key === shown[0]?.key ? (
                        <Link
                          href={row.href}
                          onClick={(event) => event.stopPropagation()}
                          className="sr-only focus:not-sr-only focus:relative focus:z-10 focus:rounded focus:outline-hidden focus:ring-2 focus:ring-ring/50"
                        >
                          {words.open}
                        </Link>
                      ) : null}
                      <RegisterCellContent cell={row.cells[column.key]} />
                    </TableCell>
                  );
                })}
                <TableCell
                  onClick={(event) => event.stopPropagation()}
                  className="sticky end-0 z-[3] w-28 min-w-28 bg-card whitespace-nowrap py-2.5 px-2 text-end align-middle"
                >
                  <div className="flex items-center justify-end gap-0.5">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`${words.quickView} — ${row.label ?? ""}`}
                      onClick={() => setQuickRow(row)}
                    >
                      <Eye className="size-3.5" aria-hidden />
                    </Button>
                    {canManage && row.editHref ? (
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        nativeButton={false}
                        className="hover:bg-primary/10 hover:text-primary transition-colors"
                        render={
                          <Link href={row.editHref} aria-label={words.edit}>
                            <Pencil className="size-3.5" aria-hidden />
                          </Link>
                        }
                      />
                    ) : null}
                    {canDelete ? (
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`${words.delete} — ${row.label ?? ""}`}
                        disabled={removing}
                        className="hover:bg-destructive/10 hover:text-destructive transition-colors"
                        onClick={() => onDelete(row)}
                      >
                        <Trash2 className="size-3.5 text-destructive" aria-hidden />
                      </Button>
                    ) : null}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <RegisterQuickView
        row={quickRow}
        columns={shown}
        open={quickRow !== null}
        onOpenChange={(open) => !open && setQuickRow(null)}
        words={{ title: words.quickView, openRecord: words.open, empty: "—" }}
      />
    </>
  );
}
