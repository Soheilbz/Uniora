"use client";

import { GitCompareArrows, X } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useActionState, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { ActionResult } from "@/lib/register/action-result.ts";
import type { BulkEditableField } from "@/lib/register/bulk-edit.ts";
import { RegisterCompare } from "./register-compare";
import { RegisterTable } from "./register-table";
import { FilterSelect } from "./register-view-cells";
import { RegisterViewToolbar } from "./register-view-toolbar";
import { singleSelection, visibleColumns } from "./table-state.ts";

/**
 * A register: its command strip, its filters, its table and its foot.
 *
 * ── Why the whole band is one client component ──────────────────────────────
 *
 * Selection is the reason. Ticking a row changes what four commands on the
 * toolbar above the table do — «ویرایش» becomes available, «حذف گروهی» learns a
 * count, the selection bar appears — so the checkbox in row seven and the button
 * in the strip have to be in one interactive tree. Splitting them would mean a
 * context provider wrapping both, which is the same client tree with an extra
 * layer.
 *
 * What did *not* move to the client is the data. The rows arrive already
 * queried, filtered, sorted, paged and — importantly — with their vocabulary
 * words already resolved: the browser is never sent the institution's
 * vocabularies, only the labels for the ten rows on screen. Sorting and paging
 * are still links, so they still work with the JavaScript still loading.
 */

export type {
  RegisterBadge,
  RegisterCell,
  RegisterColumn,
  RegisterFilterView,
  RegisterViewRow,
} from "./register-view-types.ts";

import type { RegisterColumn, RegisterFilterView, RegisterViewRow } from "./register-view-types.ts";

/**
 * The delete a read-only register does not have.
 *
 * `useActionState` cannot be called conditionally, so a register with no delete
 * still needs something to hand it. This refuses rather than pretending to
 * succeed — if a future change ever wires a control to it, the screen says so
 * instead of quietly reporting that nothing was removed.
 */
const NOTHING_TO_DO = async (): Promise<ActionResult> => ({
  ok: false,
  message: "errors.record.missing",
});

export function RegisterView({
  columns,
  rows,
  filters,
  filtersShown,
  toggleFiltersHref,
  clearHref,
  narrowed,
  matched,
  registerSize,
  unit,
  canManage,
  canExport,
  exportHref,
  reportsHref,
  addHref,
  addLabel,
  deleteAction,
  bulkEditAction,
  bulkEditFields,
  recordActions,
  viewsSlot,
  reportActions,
  importSlot,
  searchSlot,
  emptySlot,
  footerSlot,
  enableCompare = false,
}: {
  columns: RegisterColumn[];
  rows: RegisterViewRow[];
  filters: RegisterFilterView[];
  filtersShown: boolean;
  toggleFiltersHref: string;
  clearHref: string;
  narrowed: boolean;
  matched: number;
  registerSize: number;
  /** This register's word for one record — «نفر». */
  unit: string;
  canManage: boolean;
  canExport: boolean;
  exportHref: string;
  /**
   * The register's own report, where it has one.
   *
   * A report is *about* a register and is reached from it — there is no
   * «گزارش‌ها» in the sidebar, and a top-level index would put a choice in
   * front of an answer the reader already has. Omitted where a register has no
   * report, rather than rendering a disabled control for one.
   */
  reportsHref?: string | undefined;
  /**
   * Where «افزودن» goes — and whether this register writes at all.
   *
   * Omitted together with `addLabel` and `deleteAction` by a register that is a
   * *view*: the workshops screen's instructors, participants and certificates
   * tabs each list rows belonging to a workshop, and every one of them is
   * created, corrected and removed on that workshop's own record, where the
   * person doing it can see the capacity, the attendance and the certificate
   * together. An «افزودن» there would have to ask which workshop first.
   *
   * The record group is then *absent* rather than disabled — the same rule the
   * rest of this toolbar follows, and the reason `/professor-capacity` and
   * `/reviewer-counts` have no record group either.
   */
  addHref?: string | undefined;
  /** This register's own word — «ثبت جلسه», not «افزودن دانشجو». */
  addLabel?: string | undefined;
  deleteAction?:
    | ((previous: ActionResult | null, form: FormData) => Promise<ActionResult>)
    | undefined;
  /**
   * Setting one vocabulary field across the ticked rows.
   *
   * Passed as an action plus the fields it may set, rather than as a rendered
   * control, because the dialog needs the live selection — which only this
   * component holds. Omitted where a register has no field worth setting in
   * bulk, and the command is then absent rather than disabled.
   */
  bulkEditAction?: (previous: ActionResult | null, form: FormData) => Promise<ActionResult>;
  bulkEditFields?: BulkEditableField[];
  /** Extra commands in the record group — shown only where the viewer may manage. */
  recordActions?: React.ReactNode;
  /** Extra commands in the report group — the documents this register produces. */
  reportActions?: React.ReactNode;
  /**
   * Reading a spreadsheet back in — the other half of «صادرات».
   *
   * Rendered by the caller rather than described here, because the dialog needs
   * this register's own two Server Actions and a component cannot be handed one
   * generically without the caller building it anyway. Omitted where a register
   * has no import, and the command is then absent rather than disabled.
   */
  importSlot?: React.ReactNode;
  /**
   * This register's saved views, rendered by the caller.
   *
   * A slot rather than a described prop, for the reason `importSlot` gives: the
   * menu needs this register's own two Server Actions and the address it is
   * looking at, and neither can be handed to a component generically without
   * the caller assembling it anyway.
   */
  viewsSlot?: React.ReactNode;
  searchSlot: React.ReactNode;
  emptySlot: React.ReactNode;
  footerSlot: React.ReactNode;
  /** Compare exactly two rows without leaving the register. Selection remains read-only for viewers. */
  enableCompare?: boolean;
}) {
  const t = useTranslations("common");
  const actions = useTranslations("actions");
  const [, startTransition] = useTransition();
  /*
   * Both hooks run unconditionally, because hooks must.
   *
   * A register that is a *view* is handed no delete at all, and `NOTHING_TO_DO`
   * stands in so the call is still made. It is unreachable rather than merely
   * unused: the record group that holds the controls able to dispatch
   * it is not rendered without a real action — see `writes` below.
   */
  const [deleteResult, remove, removing] = useActionState(deleteAction ?? NOTHING_TO_DO, null);
  const say = useTranslations();

  /*
   * The dialog closes on success, not on the click.
   *
   * It remains open until the confirmed action's
   * result was discarded — so a refused delete (a conflict, a record somebody
   * else had already retired) closed nothing, changed nothing and said
   * nothing, indistinguishable from a button that does not work. Now a failure
   * keeps the dialog open and says why; the effect is what closes it when the
   * action reports back that the row really went.
   *
   * `nonce` is why an old failure cannot haunt a new dialog: each opening mints
   * one, the confirm records which attempt it belongs to, and the refusal is
   * shown only when those agree. Without it, a failed delete followed by
   * cancelling and opening another row would show the first record's refusal
   * on the second.
   */
  const [confirming, setConfirming] = useState<{
    kind: "one";
    row: RegisterViewRow;
    nonce: number;
  } | null>(null);
  const nextNonce = useRef(0);
  const attemptedNonce = useRef<number | null>(null);
  const [failedNonce, setFailedNonce] = useState<number | null>(null);

  useEffect(() => {
    if (!deleteResult) return;
    if (deleteResult.ok) {
      setConfirming(null);
      setFailedNonce(null);
      return;
    }
    /* A refusal is bound to the attempt that produced it. */
    if (attemptedNonce.current !== null) setFailedNonce(attemptedNonce.current);
  }, [deleteResult]);

  useEffect(() => {
    if (failedNonce !== null && confirming?.nonce !== failedNonce) {
      /* The refused attempt's dialog is gone — clear the refusal with it. */
      setFailedNonce(null);
    }
  }, [confirming, failedNonce]);

  /*
   * The state this register keeps, and the rules that move it, in
   * `table-state.ts`.
   *
   * They are separate because neither is reachable from a rendered page: the
   * picker's contents mount only when the menu opens, and a selection exists
   * only after a click. Kept inline here, «ticking a row already ticked unticks
   * it» would be a behaviour with no test at all.
   */
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const [compareOpen, setCompareOpen] = useState(false);

  /**
   * Whether this register writes at all.
   */
  const writes = Boolean(addHref || deleteAction || recordActions);

  const shown = useMemo(() => visibleColumns(columns, hidden), [columns, hidden]);
  /* The version each ticked row was read at — what the bulk edit's per-row
     guard compares against. Rows without one simply do not appear here. */
  const versionsById = useMemo(
    () =>
      new Map(
        rows.flatMap((row) => (row.version === undefined ? [] : [[row.id, row.version] as const])),
      ),
    [rows],
  );

  const editHref = rows.find((row) => row.id === singleSelection(selected))?.editHref;
  const comparedRows = useMemo(() => {
    if (!enableCompare || selected.size !== 2) return null;
    const picked = rows.filter((row) => selected.has(row.id));
    return picked.length === 2
      ? ([picked[0], picked[1]] as [RegisterViewRow, RegisterViewRow])
      : null;
  }, [enableCompare, rows, selected]);

  return (
    <div className="flex flex-1 flex-col gap-2.5 min-h-0 h-full">
      {/*
       * The commands sit above the filters, as the application has
       * them: you narrow the list first, then act on what you narrowed it to.
       */}
      <RegisterViewToolbar
        columns={columns}
        hidden={hidden}
        setHidden={setHidden}
        selected={selected}
        setSelected={setSelected}
        versionsById={versionsById}
        filtersShown={filtersShown}
        toggleFiltersHref={toggleFiltersHref}
        canManage={canManage}
        writes={writes}
        addHref={addHref}
        addLabel={addLabel}
        editHref={editHref}
        recordActions={recordActions}
        bulkEditAction={bulkEditAction}
        bulkEditFields={bulkEditFields}
        viewsSlot={viewsSlot}
        reportsHref={reportsHref}
        reportActions={reportActions}
        importSlot={importSlot}
        canExport={canExport}
        exportHref={exportHref}
      />

      <div
        data-print-hide
        hidden={!filtersShown}
        className="relative z-20 flex flex-wrap items-end gap-3 rounded-xl border border-border/80 bg-card/85 p-3.5 shadow-2xs backdrop-blur-xs"
      >
        <div className="flex w-full flex-col gap-1 sm:w-64 md:w-72 shrink-0">
          <span className="text-xs font-semibold text-foreground/80">{t("search")}</span>
          {searchSlot}
        </div>
        <div className="flex flex-1 flex-wrap items-end gap-2.5">
          {filters.map((filter) => (
            <FilterSelect key={filter.key} filter={filter} allLabel={t("all")} />
          ))}
        </div>
        {narrowed && (
          <Button
            variant="outline"
            size="sm"
            nativeButton={false}
            className="h-9 shrink-0 gap-1.5 px-3 text-xs text-muted-foreground hover:border-destructive/40 hover:text-destructive transition-colors"
            render={
              <Link href={clearHref}>
                <X className="size-3.5" aria-hidden />
                {t("clearFilters")}
              </Link>
            }
          />
        )}
      </div>

      {/*
       * The tag strip: what is narrowing the list, and how much of it survived.
       *
       * «۱۰ نفر از ۲۶» is the sentence a clerk actually needs — a bare count of
       * results does not say whether a filter caught most of the register or
       * almost none of it, which is the difference between a useful filter and a
       * typo.
       */}
      <div data-print-hide className="flex flex-wrap items-center gap-2">
        {filters
          .filter((filter) => filter.value)
          .map((filter) => (
            <Badge
              key={filter.key}
              variant="outline"
              className="gap-1.5 rounded-lg border-border/70 bg-background/80 px-2.5 py-1 text-xs font-medium shadow-2xs"
            >
              <span className="text-muted-foreground">{filter.label}:</span>
              <span className="font-semibold text-foreground">{filter.valueLabel}</span>
              <Link
                href={filter.clearHref}
                aria-label={`${t("clear")} ${filter.label}`}
                className="rounded-md p-0.5 hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40"
              >
                <X className="size-3" aria-hidden />
              </Link>
            </Badge>
          ))}

        <span className="numeric text-xs font-medium text-muted-foreground">
          {narrowed
            ? t("matchedOf", { matched, total: registerSize, unit })
            : t("registerSize", { total: registerSize, unit })}
        </span>

        {narrowed && (
          <Button
            variant="ghost"
            size="sm"
            nativeButton={false}
            className="h-7 text-xs font-medium text-primary hover:bg-primary/10"
            render={<Link href={clearHref}>{t("clearFilters")}</Link>}
          />
        )}
      </div>

      {/* Between the toolbar and the table, because it is the scope every
          command above it is about to act on. */}
      {selected.size > 0 && (
        <div
          data-print-hide
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-primary/30 bg-primary/10 px-4 py-2.5 text-sm shadow-2xs backdrop-blur-xs animate-in fade-in slide-in-from-top-1 duration-200"
        >
          <div className="flex items-center gap-2">
            <span className="flex size-2 rounded-full bg-primary animate-pulse" />
            <span className="numeric font-medium text-foreground">
              {t("selectedCount", { count: selected.size })}
            </span>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setSelected(new Set())}
            className="h-7 text-xs font-medium hover:bg-primary/20"
          >
            {t("clearSelection")}
          </Button>
          {comparedRows ? (
            <Button variant="outline" size="sm" onClick={() => setCompareOpen(true)}>
              <GitCompareArrows className="size-3.5" aria-hidden />
              {t("compare")}
            </Button>
          ) : null}
        </div>
      )}

      {rows.length === 0 ? (
        emptySlot
      ) : (
        <RegisterTable
          columns={columns}
          rows={rows}
          hidden={hidden}
          selected={selected}
          setSelected={setSelected}
          canManage={canManage}
          canDelete={canManage && Boolean(deleteAction)}
          enableCompare={enableCompare}
          removing={removing}
          onDelete={(row) => setConfirming({ kind: "one", row, nonce: nextNonce.current++ })}
          words={{
            edit: t("edit"),
            delete: t("delete"),
            open: actions("open"),
            actions: actions("actions"),
            selectAll: actions("selectAll"),
            selectRow: actions("selectRow"),
            quickView: t("quickView"),
            pin: t("pin"),
            unpin: t("unpin"),
            resizeColumn: (column) => t("resizeColumn", { column }),
            multiSortHint: t("multiSortHint"),
            empty: "—",
          }}
        />
      )}

      {rows.length > 0 && footerSlot}

      <RegisterCompare
        rows={comparedRows}
        columns={shown}
        open={compareOpen}
        onOpenChange={setCompareOpen}
        words={{ title: t("compare"), description: t("compareDescription"), empty: "—" }}
      />
      {/*
       * The one dialog both destructive commands go through.
       *
       * Both actions require confirmation: «حذف گروهی» can remove every ticked record the
       * moment it was pressed. That is a control one row of the toolbar away
       * from «ویرایش», acting on whatever happened to be selected, with no
       * question asked — and a register of two thousand people is a register
       * where a mis-aimed click is not a small event.
       *
       * The *number* is in the sentence, and that is the part that matters. A
       * reader cannot confirm a count they have not been shown, and the count is
       * the whole difference between tidying up eleven rows and emptying the
       * office's archive.
       */}
      <Dialog open={confirming !== null} onOpenChange={(open) => !open && setConfirming(null)}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>{actions("deleteOneTitle")}</DialogTitle>
            <DialogDescription>
              {confirming?.kind === "one" &&
                actions("deleteOneBody", { name: confirming.row.label ?? "" })}
            </DialogDescription>
          </DialogHeader>

          {/* A refusal, said rather than swallowed — same as the record page's
              delete dialog. Catalogue keys come back from the action and are
              worded here, where the viewer's locale lives; the nonce check is
              what keeps a previous attempt's refusal out of this dialog. */}
          {confirming !== null &&
            failedNonce === confirming.nonce &&
            deleteResult !== null &&
            !deleteResult.ok && (
              <p role="alert" className="text-sm text-destructive">
                {say(deleteResult.message ?? "errors.record.conflict")}
              </p>
            )}

          <DialogFooter>
            <Button
              variant="destructive"
              disabled={removing}
              onClick={() => {
                if (confirming?.kind === "one") {
                  const form = new FormData();
                  form.append("id", confirming.row.id);
                  if (confirming.row.version !== undefined) {
                    form.append("version", String(confirming.row.version));
                  }
                  attemptedNonce.current = confirming.nonce;
                  startTransition(() => remove(form));
                }
              }}
            >
              {t("delete")}
            </Button>
            {/* Second in the markup and therefore second in the tab order, so
                focus does not land on the destructive action. */}
            <Button variant="ghost" onClick={() => setConfirming(null)}>
              {t("cancel")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
