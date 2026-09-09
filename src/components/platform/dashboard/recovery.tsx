import { randomUUID } from "node:crypto";
import { HardDrive } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { PendingSubmitButton } from "@/components/pending-submit-button";
import { formatBytes } from "@/components/platform/operational-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requestPlatformBackup } from "@/modules/platform/actions";
import type { readPlatformOperationalHealth } from "@/modules/platform/operations";

type Health = Awaited<ReturnType<typeof readPlatformOperationalHealth>>;
export async function PlatformRecoverySection({
  operationalHealth,
}: {
  operationalHealth: Health;
}) {
  const t = await getTranslations("platform");
  return (
    <section
      className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,0.7fr)]"
      aria-label={t("backupManagement")}
    >
      <Card>
        <CardHeader className="border-b">
          <CardTitle className="flex items-center gap-2">
            <HardDrive className="size-5 text-primary" aria-hidden />
            {t("backupManagement")}
          </CardTitle>
          <CardDescription>{t("backupManagementDescription")}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 pt-5 sm:grid-cols-2">
          <div className="rounded-xl border bg-muted/20 p-4">
            <p className="text-xs text-muted-foreground">{t("backupAge")}</p>
            <p className="mt-1 text-xl font-semibold numeric">
              {operationalHealth.backup.ageHours === null
                ? t("notAvailable")
                : t("hours", { count: operationalHealth.backup.ageHours })}
            </p>
            <p
              className="mt-1 truncate text-xs text-muted-foreground"
              title={operationalHealth.backup.manifest ?? undefined}
            >
              {operationalHealth.backup.manifest ?? t("noBackupManifest")}
            </p>
            <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
              <span>{t("retainedBackups")}</span>
              <span className="text-end font-medium numeric">
                {operationalHealth.backup.retainedCount}
              </span>
              <span>{t("backupTotalSize")}</span>
              <span className="text-end font-medium numeric">
                {formatBytes(operationalHealth.backup.totalBytes)}
              </span>
            </div>
            <Button
              variant="link"
              size="xs"
              nativeButton={false}
              render={<Link href="/platform/backups" />}
              className="mt-2 h-auto px-0"
            >
              {t("viewBackupList")}
            </Button>
          </div>
          <div className="flex flex-wrap content-center gap-2 sm:justify-end">
            <form action={requestPlatformBackup}>
              <input type="hidden" name="requestId" value={randomUUID()} />
              <input type="hidden" name="action" value="create" />
              <PendingSubmitButton>{t("createBackup")}</PendingSubmitButton>
            </form>
            <form action={requestPlatformBackup}>
              <input type="hidden" name="requestId" value={randomUUID()} />
              <input type="hidden" name="action" value="verify" />
              <Button type="submit" variant="outline">
                {t("verifyBackup")}
              </Button>
            </form>
          </div>
          <p className="text-xs text-muted-foreground sm:col-span-2">{t("backupQueueHint")}</p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="border-b">
          <CardTitle>{t("storageManagement")}</CardTitle>
          <CardDescription>{t("storageManagementDescription")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 pt-5">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm">{t("objectStorage")}</span>
            <Badge
              variant={operationalHealth.storage.status === "verified" ? "secondary" : "outline"}
            >
              {operationalHealth.storage.status === "verified"
                ? t("verified")
                : operationalHealth.storage.status === "unreachable"
                  ? t("storageUnreachable")
                  : operationalHealth.storage.status === "partial"
                    ? t("storagePartial")
                    : t("notConfigured")}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground">{t("storageManagementHint")}</p>
        </CardContent>
      </Card>
    </section>
  );
}
