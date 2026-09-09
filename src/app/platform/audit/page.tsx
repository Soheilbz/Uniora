import { ArrowRight, FileSearch } from "lucide-react";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TablePagination } from "@/components/ui/table-pagination";
import { formatAuditChanges } from "@/lib/audit/changes.ts";
import { createDateFormatter } from "@/lib/locale-format";
import { requirePlatformConsoleOperator } from "@/lib/platform-viewer.ts";
import { readPlatformAuditEvents } from "@/modules/platform/queries";

export const dynamic = "force-dynamic";

function dateValue(value: string | undefined, end = false): Date | undefined {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return undefined;
  if (end) date.setUTCDate(date.getUTCDate() + 1);
  return date;
}

export default async function PlatformAuditPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    outcome?: string;
    action?: string;
    from?: string;
    to?: string;
    cursor?: string;
    direction?: "next" | "prev";
  }>;
}) {
  await requirePlatformConsoleOperator();
  const [params, t, locale] = await Promise.all([
    searchParams,
    getTranslations("platform"),
    getLocale(),
  ]);
  const result = await readPlatformAuditEvents({
    query: params.q,
    outcome:
      params.outcome && ["success", "failure"].includes(params.outcome)
        ? params.outcome
        : undefined,
    action: params.action?.trim() || undefined,
    from: dateValue(params.from),
    to: dateValue(params.to, true),
    limit: 25,
    cursor: params.cursor,
    direction: params.direction,
  });
  const dateFormatter = createDateFormatter(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  });
  const makeCursorUrl = (cursor: string, direction: "next" | "prev") => {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value && key !== "cursor" && key !== "direction") query.set(key, value);
    }
    query.set("cursor", cursor);
    query.set("direction", direction);
    return `/platform/audit?${query.toString()}`;
  };
  return (
    <main dir={locale === "en" ? "ltr" : "rtl"} className="min-h-svh bg-background">
      <div className="mx-auto max-w-7xl space-y-5 px-4 py-6 sm:px-6 lg:px-8">
        <h1 className="sr-only">{t("auditExplorer")}</h1>
        <Button variant="ghost" nativeButton={false} render={<Link href="/platform" />}>
          <ArrowRight aria-hidden />
          {t("backToPlatform")}
        </Button>
        <Card>
          <CardHeader className="border-b">
            <CardTitle className="flex items-center gap-2">
              <FileSearch className="size-5 text-primary" aria-hidden />
              {t("auditExplorer")}
            </CardTitle>
            <CardDescription>{t("auditExplorerDescription")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 pt-5">
            <form className="grid gap-2 sm:grid-cols-[1.5fr_10rem_1fr_10rem_10rem_auto]">
              <input
                name="q"
                defaultValue={params.q}
                placeholder={t("auditSearchPlaceholder")}
                className="h-9 rounded-lg border bg-transparent px-3"
              />
              <select
                name="outcome"
                defaultValue={params.outcome ?? ""}
                aria-label={t("auditOutcome")}
                className="h-9 rounded-lg border bg-background px-3"
              >
                <option value="">{t("allOutcomes")}</option>
                <option value="success">{t("success")}</option>
                <option value="failure">{t("failure")}</option>
              </select>
              <input
                name="action"
                defaultValue={params.action}
                placeholder={t("auditActionPlaceholder")}
                className="h-9 rounded-lg border bg-transparent px-3"
                dir="ltr"
              />
              <input
                type="date"
                name="from"
                defaultValue={params.from}
                aria-label={t("auditFrom")}
                className="h-9 rounded-lg border bg-background px-3"
              />
              <input
                type="date"
                name="to"
                defaultValue={params.to}
                aria-label={t("auditTo")}
                className="h-9 rounded-lg border bg-background px-3"
              />
              <Button type="submit" variant="outline">
                {t("filter")}
              </Button>
            </form>
            <div className="text-xs text-muted-foreground">
              <span>{t("auditWindowCount", { count: result.items.length })}</span>
            </div>
            {result.items.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">
                {t("noAuditEvents")}
              </p>
            ) : (
              <Table
                containerClassName="rounded-lg border"
                className="table-auto min-w-[1050px] text-sm"
              >
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>{t("auditDate")}</TableHead>
                    <TableHead>{t("auditOperator")}</TableHead>
                    <TableHead>{t("auditAction")}</TableHead>
                    <TableHead>{t("auditTarget")}</TableHead>
                    <TableHead>{t("auditChanges")}</TableHead>
                    <TableHead>{t("auditOutcome")}</TableHead>
                    <TableHead>{t("auditRequestId")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {result.items.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell className="whitespace-nowrap">
                        {dateFormatter.format(item.createdAt)}
                      </TableCell>
                      <TableCell dir="ltr">{item.operator}</TableCell>
                      <TableCell className="font-medium" dir="ltr">
                        {item.action}
                      </TableCell>
                      <TableCell>
                        <div>
                          {[item.tenantName, item.tenantSlug].filter(Boolean).join(" · ") || "—"}
                        </div>
                        <div className="text-xs text-muted-foreground" dir="ltr">
                          {item.target ?? "—"}
                        </div>
                      </TableCell>
                      <TableCell className="max-w-[28rem]">
                        <pre
                          className="max-h-28 overflow-auto whitespace-pre-wrap break-words rounded bg-muted/30 p-2 text-xs"
                          dir="ltr"
                        >
                          {formatAuditChanges(item.changes)}
                        </pre>
                      </TableCell>
                      <TableCell>
                        <Badge variant={item.outcome === "success" ? "secondary" : "destructive"}>
                          {item.outcome}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs" dir="ltr">
                        {item.requestId ?? "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
            <TablePagination className="rounded-t-none border-x-0 border-b-0 shadow-none">
              {result.hasPrevious && result.previousCursor ? (
                <Button
                  variant="outline"
                  nativeButton={false}
                  render={<Link href={makeCursorUrl(result.previousCursor, "prev")} />}
                >
                  {t("previous")}
                </Button>
              ) : (
                <span />
              )}
              {result.hasNext && result.nextCursor ? (
                <Button
                  variant="outline"
                  nativeButton={false}
                  render={<Link href={makeCursorUrl(result.nextCursor, "next")} />}
                >
                  {t("next")}
                </Button>
              ) : (
                <span />
              )}
            </TablePagination>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
