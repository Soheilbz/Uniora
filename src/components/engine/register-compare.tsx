"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { RegisterColumn, RegisterViewRow } from "./register-view-types.ts";

function value(row: RegisterViewRow, key: string, empty: string): string {
  const cell = row.cells[key];
  const primary = cell?.text ?? cell?.list?.filter(Boolean).join("، ") ?? "";
  return [primary, cell?.secondary].filter(Boolean).join(" · ") || empty;
}

export function RegisterCompare({
  rows,
  columns,
  open,
  onOpenChange,
  words,
}: {
  rows: [RegisterViewRow, RegisterViewRow] | null;
  columns: RegisterColumn[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  words: { title: string; description: string; empty: string };
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl">
        <DialogHeader>
          <DialogTitle>{words.title}</DialogTitle>
          <DialogDescription>{words.description}</DialogDescription>
        </DialogHeader>
        {rows ? (
          <Table containerClassName="max-h-[70vh] rounded-lg border" className="table-auto text-sm">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="text-muted-foreground" />
                <TableHead>{rows[0].label ?? rows[0].id}</TableHead>
                <TableHead>{rows[1].label ?? rows[1].id}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {columns.map((column) => (
                <TableRow key={column.key}>
                  <TableHead className="w-48 align-top text-xs font-medium text-muted-foreground">
                    {column.header}
                  </TableHead>
                  <TableCell className="align-top">
                    {value(rows[0], column.key, words.empty)}
                  </TableCell>
                  <TableCell className="align-top">
                    {value(rows[1], column.key, words.empty)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
