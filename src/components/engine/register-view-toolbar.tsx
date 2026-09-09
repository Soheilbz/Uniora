"use client";

import {
  ChartColumn,
  Columns3,
  FileDown,
  Filter,
  Pencil,
  Plus,
  Printer,
  RefreshCw,
} from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { type Dispatch, type ReactNode, type SetStateAction, useTransition } from "react";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuGroupLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ActionResult } from "@/lib/register/action-result.ts";
import type { BulkEditableField } from "@/lib/register/bulk-edit.ts";
import type { RegisterColumn } from "./register-view-types.ts";
import { toggleColumn } from "./table-state.ts";
import { Toolbar, ToolbarButton, ToolbarDivider, ToolbarGroup } from "./toolbar";

const BulkEditDialog = dynamic(() =>
  import("./bulk-edit-dialog").then((module) => module.BulkEditDialog),
);

export function RegisterViewToolbar({
  columns,
  hidden,
  setHidden,
  selected,
  setSelected,
  versionsById,
  filtersShown,
  toggleFiltersHref,
  canManage,
  writes,
  addHref,
  addLabel,
  editHref,
  recordActions,
  bulkEditAction,
  bulkEditFields,
  viewsSlot,
  reportsHref,
  reportActions,
  importSlot,
  canExport,
  exportHref,
}: {
  columns: RegisterColumn[];
  hidden: ReadonlySet<string>;
  setHidden: Dispatch<SetStateAction<ReadonlySet<string>>>;
  selected: ReadonlySet<string>;
  setSelected: Dispatch<SetStateAction<ReadonlySet<string>>>;
  versionsById: ReadonlyMap<string, number>;
  filtersShown: boolean;
  toggleFiltersHref: string;
  canManage: boolean;
  writes: boolean;
  addHref?: string | undefined;
  addLabel?: string | undefined;
  editHref?: string | undefined;
  recordActions?: ReactNode | undefined;
  bulkEditAction?:
    | ((previous: ActionResult | null, form: FormData) => Promise<ActionResult>)
    | undefined;
  bulkEditFields?: BulkEditableField[] | undefined;
  viewsSlot?: ReactNode | undefined;
  reportsHref?: string | undefined;
  reportActions?: ReactNode | undefined;
  importSlot?: ReactNode | undefined;
  canExport: boolean;
  exportHref: string;
}) {
  const t = useTranslations("common");
  const actions = useTranslations("actions");
  const router = useRouter();
  const [, startTransition] = useTransition();

  return (
    <Toolbar label={actions("toolbar")}>
      {canManage && writes && (
        <>
          <ToolbarGroup label={actions("group.record")}>
            {addHref && addLabel && (
              <ToolbarButton
                primary
                nativeButton={false}
                render={
                  <Link href={addHref}>
                    <Plus className="size-4" aria-hidden />
                    {addLabel}
                  </Link>
                }
              />
            )}
            <ToolbarButton
              icon={<Pencil className="size-4" aria-hidden />}
              disabled={!editHref}
              onClick={() => editHref && startTransition(() => router.push(editHref))}
            >
              {t("edit")}
            </ToolbarButton>
            {recordActions}
            {bulkEditAction && bulkEditFields && bulkEditFields.length > 0 && (
              <BulkEditDialog
                fields={bulkEditFields}
                selected={[...selected]}
                versionsById={versionsById}
                action={bulkEditAction}
                disabled={selected.size === 0}
              />
            )}
          </ToolbarGroup>
          <ToolbarDivider />
        </>
      )}

      <ToolbarGroup label={actions("group.view")}>
        <ToolbarButton
          checked={filtersShown}
          href={toggleFiltersHref}
          icon={<Filter className="size-4" aria-hidden />}
        >
          {actions("filters")}
        </ToolbarButton>

        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <ToolbarButton icon={<Columns3 className="size-4" aria-hidden />}>
                {actions("columns")}
              </ToolbarButton>
            }
          />
          <DropdownMenuContent align="end">
            <DropdownMenuGroup>
              <DropdownMenuGroupLabel>{actions("columns")}</DropdownMenuGroupLabel>
              <DropdownMenuSeparator />
              {columns.map((column) => (
                <DropdownMenuCheckboxItem
                  key={column.key}
                  checked={!hidden.has(column.key)}
                  disabled={column.locked}
                  onCheckedChange={(next: boolean) =>
                    setHidden((current) => toggleColumn(current, column, next))
                  }
                >
                  {column.header}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>

        <ToolbarButton
          icon={<RefreshCw className="size-4" aria-hidden />}
          onClick={() => {
            setSelected(new Set());
            startTransition(() => router.refresh());
          }}
        >
          {actions("refresh")}
        </ToolbarButton>
        {viewsSlot}
      </ToolbarGroup>

      <ToolbarDivider />

      <ToolbarGroup label={actions("group.report")}>
        <ToolbarButton
          icon={<Printer className="size-4" aria-hidden />}
          onClick={() => window.print()}
        >
          {t("print")}
        </ToolbarButton>
        {reportsHref && (
          <ToolbarButton
            nativeButton={false}
            render={
              <Link href={reportsHref}>
                <ChartColumn className="size-4" aria-hidden />
                {actions("reports")}
              </Link>
            }
          />
        )}
        {reportActions}
        {importSlot}
        {canExport && (
          <ToolbarButton
            nativeButton={false}
            render={
              <a href={exportHref} download>
                <FileDown className="size-4" aria-hidden />
                {actions("export")}
              </a>
            }
          />
        )}
      </ToolbarGroup>
    </Toolbar>
  );
}
