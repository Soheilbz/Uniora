import { ArrowRight, CheckCircle2, HardDrive, ShieldCheck } from "lucide-react";
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
import { createDateFormatter } from "@/lib/locale-format";
import { requirePlatformConsoleOperator } from "@/lib/platform-viewer.ts";
import { readPlatformOperationalHealth } from "@/modules/platform/operations";

export const dynamic = "force-dynamic";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export default async function PlatformBackupsPage() {
  await requirePlatformConsoleOperator();
  const [health, t, locale] = await Promise.all([
    readPlatformOperationalHealth(),
    getTranslations("platform"),
    getLocale(),
  ]);
  const isEnglish = locale === "en";
  const dateFormatter = createDateFormatter(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  });
  const backups = [...health.backup.backups].sort(
    (left, right) => right.createdAt.getTime() - left.createdAt.getTime(),
  );
  return (
    <main dir={isEnglish ? "ltr" : "rtl"} className="min-h-svh bg-background text-foreground">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-4 py-6 sm:px-6 lg:px-8">
        <Button variant="ghost" nativeButton={false} render={<Link href="/platform" />}>
          <ArrowRight aria-hidden />
          {t("backToPlatform")}
        </Button>
        <header className="flex flex-wrap items-start justify-between gap-4 rounded-2xl border bg-card p-5 shadow-sm">
          <div className="flex items-start gap-3">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <HardDrive className="size-5" aria-hidden />
            </span>
            <div>
              <h1 className="text-xl font-bold tracking-tight sm:text-2xl">{t("backupList")}</h1>
              <p className="mt-1 text-sm text-muted-foreground">{t("backupListDescription")}</p>
            </div>
          </div>
          <Badge variant={health.backup.backups.length > 0 ? "secondary" : "outline"}>
            {t("retainedBackups")}: {health.backup.backups.length}
          </Badge>
        </header>
        <Card>
          <CardHeader className="border-b">
            <CardTitle className="flex items-center gap-2">
              <ShieldCheck className="size-5 text-primary" aria-hidden />
              {t("backupInventory")}
            </CardTitle>
            <CardDescription>{t("backupInventoryDescription")}</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {backups.length === 0 ? (
              <div className="px-6 py-12 text-center text-sm text-muted-foreground">
                {t("noBackupManifest")}
              </div>
            ) : (
              <Table className="table-auto min-w-[760px] text-sm">
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>{t("manifest")}</TableHead>
                    <TableHead>{t("createdAt")}</TableHead>
                    <TableHead>{t("size")}</TableHead>
                    <TableHead>{t("verificationStatus")}</TableHead>
                    <TableHead>{t("offsiteStatus")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {backups.map((backup) => (
                    <TableRow key={backup.manifest}>
                      <TableCell className="max-w-[360px] font-mono text-xs" dir="ltr">
                        <span className="break-all">{backup.manifest}</span>
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {dateFormatter.format(backup.createdAt)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap numeric">
                        {formatBytes(backup.sizeBytes)}
                      </TableCell>
                      <TableCell>
                        <Badge variant={backup.metadataValid ? "secondary" : "destructive"}>
                          {backup.metadataValid ? <CheckCircle2 aria-hidden /> : null}
                          {backup.lastVerifiedAt
                            ? t("verifiedAt", {
                                date: dateFormatter.format(backup.lastVerifiedAt),
                              })
                            : t("metadataValid")}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant={backup.offsite ? "secondary" : "outline"}>
                          {backup.offsite ? t("offsite") : t("localOnly")}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
