import { randomUUID } from "node:crypto";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { PendingSubmitButton } from "@/components/pending-submit-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { createDateFormatter } from "@/lib/locale-format";
import { requestTenantCreate } from "@/modules/platform/actions";
import type { readPlatformOperationRequests } from "@/modules/platform/queries";

type Operations = Awaited<ReturnType<typeof readPlatformOperationRequests>>;
export async function PlatformAdministrationSection({ operations }: { operations: Operations }) {
  const [t, locale] = await Promise.all([getTranslations("platform"), getLocale()]);
  const dateTimeFormatter = createDateFormatter(locale, { dateStyle: "short", timeStyle: "short" });
  return (
    <section className="grid gap-4 lg:grid-cols-[minmax(0,1.25fr)_minmax(20rem,0.75fr)]">
      <div className="space-y-4">
        <Card>
          <CardHeader className="border-b">
            <CardTitle>{t("createUniversity")}</CardTitle>
            <CardDescription>{t("createUniversitySubtitle")}</CardDescription>
          </CardHeader>
          <CardContent className="pt-5">
            <form action={requestTenantCreate} className="grid gap-4 sm:grid-cols-2">
              <input type="hidden" name="requestId" value={randomUUID()} />
              <label className="grid gap-1.5 text-sm">
                <span className="font-medium">{t("universityName")}</span>
                <input
                  name="name"
                  required
                  maxLength={160}
                  placeholder={t("universityNamePlaceholder")}
                  className="h-9 rounded-lg border bg-transparent px-3 outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                />
              </label>
              <label className="grid gap-1.5 text-sm">
                <span className="font-medium">{t("slug")}</span>
                <input
                  name="slug"
                  required
                  maxLength={64}
                  dir="ltr"
                  placeholder={t("slugPlaceholder")}
                  className="h-9 rounded-lg border bg-transparent px-3 outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                />
              </label>
              <label className="grid gap-1.5 text-sm">
                <span className="font-medium">{t("managerName")}</span>
                <input
                  name="managerName"
                  required
                  maxLength={160}
                  placeholder={t("managerNamePlaceholder")}
                  className="h-9 rounded-lg border bg-transparent px-3 outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                />
              </label>
              <label className="grid gap-1.5 text-sm">
                <span className="font-medium">{t("managerUsername")}</span>
                <input
                  name="managerUsername"
                  required
                  maxLength={64}
                  dir="ltr"
                  placeholder={t("managerUsernamePlaceholder")}
                  className="h-9 rounded-lg border bg-transparent px-3 outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                />
              </label>
              <label className="grid gap-1.5 text-sm sm:col-span-2">
                <span className="font-medium">{t("managerPassword")}</span>
                <input
                  name="managerPassword"
                  required
                  minLength={12}
                  maxLength={128}
                  type="password"
                  autoComplete="new-password"
                  className="h-9 rounded-lg border bg-transparent px-3 outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                />
                <span className="text-xs text-muted-foreground">{t("managerPasswordHint")}</span>
              </label>
              <div className="sm:col-span-2">
                <PendingSubmitButton pendingChildren={t("submittingOperation")}>
                  {t("submitCreate")}
                </PendingSubmitButton>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="border-b">
          <CardTitle className="flex items-center justify-between gap-3">
            <span>{t("operationHistory")}</span>
            <Button
              variant="ghost"
              size="xs"
              nativeButton={false}
              render={<Link href="/platform/operations" />}
            >
              {t("viewAll")}
            </Button>
            <Button
              variant="ghost"
              size="xs"
              nativeButton={false}
              render={<Link href="/platform/audit" />}
            >
              {t("auditExplorer")}
            </Button>
          </CardTitle>
          <CardDescription>{t("queueNote")}</CardDescription>
        </CardHeader>
        <CardContent className="pt-4">
          {operations.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("noOperations")}</p>
          ) : (
            <div className="space-y-3">
              {operations.slice(0, 3).map((operation) => {
                const retrying =
                  operation.errorCode === "operation_retrying" ||
                  operation.errorCode === "retrying_after_worker_interruption";
                const stale =
                  operation.status === "running" &&
                  Date.now() - operation.updatedAt.getTime() > 2 * 60_000;
                const statusLabel = stale
                  ? t("stale")
                  : retrying
                    ? t("retrying")
                    : operation.status === "running"
                      ? t("running")
                      : operation.status === "queued"
                        ? t("queued")
                        : operation.status === "completed"
                          ? t("completed")
                          : operation.status === "cancelled"
                            ? t("cancelled")
                            : t("failedStatus");
                const failureLabel =
                  operation.status === "failed"
                    ? operation.errorCode === "authorization_missing" ||
                      operation.errorCode === "authorization_revoked"
                      ? t("operationFailureAuthorization")
                      : operation.errorCode === "tenant_not_found"
                        ? t("operationFailureTenantNotFound")
                        : operation.errorCode === "tenant_exists"
                          ? t("operationFailureTenantExists")
                          : operation.errorCode === "target_not_eligible"
                            ? t("operationFailureTargetNotEligible")
                            : operation.errorCode === "account_not_found"
                              ? t("operationFailureAccountNotFound")
                              : operation.errorCode === "tenant_state_conflict"
                                ? t("operationFailureTenantState")
                                : operation.errorCode === "worker_configuration"
                                  ? t("operationFailureConfiguration")
                                  : operation.errorCode === "invalid_payload" ||
                                      operation.errorCode === "unsupported_operation"
                                    ? t("operationFailureInvalid")
                                    : operation.errorCode === "worker_interrupted"
                                      ? t("operationFailureInterrupted")
                                      : operation.errorCode === "operation_failed" &&
                                          !operation.failureDetail
                                        ? t("operationFailureLegacy")
                                        : t("operationFailureGeneric")
                    : null;
                return (
                  <div
                    key={operation.id}
                    className="grid gap-2 border-b pb-3 last:border-0 last:pb-0"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">
                          {t(
                            operation.kind === "tenant.create"
                              ? "operationTenantCreate"
                              : operation.kind === "backup.create"
                                ? "operationBackupCreate"
                                : operation.kind === "backup.verify"
                                  ? "operationBackupVerify"
                                  : operation.kind === "tenant.user.create"
                                    ? "operationUserCreate"
                                    : operation.kind === "tenant.user.password.reset"
                                      ? "operationPasswordReset"
                                      : operation.kind === "tenant.owner.set"
                                        ? "operationOwnerChange"
                                        : operation.kind === "tenant.rename"
                                          ? "operationTenantRename"
                                          : operation.kind === "tenant.suspend"
                                            ? "operationTenantSuspend"
                                            : operation.kind === "tenant.resume"
                                              ? "operationTenantResume"
                                              : operation.kind === "tenant.archive"
                                                ? "operationTenantArchive"
                                                : operation.kind === "break-glass.start"
                                                  ? "operationBreakGlassStart"
                                                  : operation.kind === "break-glass.end"
                                                    ? "operationBreakGlassEnd"
                                                    : operation.kind === "platform.operation.retry"
                                                      ? "operationRetry"
                                                      : operation.kind ===
                                                          "platform.operation.cancel"
                                                        ? "operationCancel"
                                                        : operation.kind,
                          )}
                        </p>
                        {operation.targetName ||
                        operation.targetUsername ||
                        operation.targetSlug ? (
                          <p className="mt-1 truncate text-xs text-muted-foreground">
                            {[operation.targetName, operation.targetUsername, operation.targetSlug]
                              .filter(Boolean)
                              .join(" · ")}
                          </p>
                        ) : null}
                        <p className="mt-1 text-xs text-muted-foreground">
                          {operation.requesterName ?? t("unknownOperator")}
                          {operation.requesterUsername ? (
                            <>
                              {" "}
                              · <span dir="ltr">{operation.requesterUsername}</span>
                            </>
                          ) : null}
                        </p>
                      </div>
                      <Badge
                        variant={
                          operation.status === "failed"
                            ? "destructive"
                            : operation.status === "completed"
                              ? "secondary"
                              : "outline"
                        }
                      >
                        {statusLabel}
                      </Badge>
                    </div>
                    {failureLabel ? (
                      <p className="text-xs text-destructive">{failureLabel}</p>
                    ) : null}
                    {operation.failureDetail ? (
                      <p className="break-words text-xs text-muted-foreground" dir="ltr">
                        {operation.failureDetail}
                      </p>
                    ) : null}
                    <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                      <span>{t("operationAttempts", { count: operation.attemptCount })}</span>
                      <time dateTime={operation.createdAt.toISOString()}>
                        {dateTimeFormatter.format(operation.createdAt)}
                      </time>
                      <span dir="ltr" className="font-mono">
                        {operation.id.slice(0, 8)}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
