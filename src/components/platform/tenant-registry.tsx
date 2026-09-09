import { randomUUID } from "node:crypto";
import { Building2 } from "lucide-react";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { PendingSubmitButton } from "@/components/pending-submit-button";
import { ArchiveTenantButton } from "@/components/platform/archive-tenant-button";
import { Badge } from "@/components/ui/badge";
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
import {
  requestTenantLifecycle,
  requestTenantOwnerChange,
  requestTenantRename,
  requestTenantUserPasswordReset,
} from "@/modules/platform/actions";
import type { PlatformTenantSummary } from "@/modules/platform/queries";

function statusKey(status: string, provisioningStatus: string) {
  if (provisioningStatus === "provisioning") return "provisioning";
  if (provisioningStatus === "failed") return "failedStatus";
  if (status === "suspended") return "suspended";
  if (status === "archived") return "archived";
  return "active";
}

export async function PlatformTenantRegistry({ tenants }: { tenants: PlatformTenantSummary[] }) {
  const [t, locale] = await Promise.all([getTranslations("platform"), getLocale()]);
  const dateFormatter = createDateFormatter(locale, {
    dateStyle: "medium",
  });
  return (
    <Card>
      <CardHeader className="border-b">
        <CardTitle>{t("universities")}</CardTitle>
        <CardDescription>{t("dashboardSubtitle")}</CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        {tenants.length === 0 ? (
          <div className="flex min-h-36 flex-col items-center justify-center gap-2 px-6 text-center text-sm text-muted-foreground">
            <Building2 className="size-5" aria-hidden />
            <p>{t("noUniversities")}</p>
          </div>
        ) : (
          <Table containerClassName="max-h-[min(62vh,42rem)]" className="min-w-[980px] table-fixed">
            <colgroup>
              <col className="w-[17%]" />
              <col className="w-[23%]" />
              <col className="w-[10%]" />
              <col className="w-[8%]" />
              <col className="w-[12%]" />
              <col className="w-[30%]" />
            </colgroup>
            <TableHeader>
              <TableRow>
                <TableHead>{t("university")}</TableHead>
                <TableHead>{t("universityAccounts")}</TableHead>
                <TableHead>{t("status")}</TableHead>
                <TableHead className="text-center">{t("accounts")}</TableHead>
                <TableHead>{t("createdAt")}</TableHead>
                <TableHead>{t("actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tenants.map((tenant) => {
                const key = statusKey(tenant.status, tenant.provisioningStatus);
                return (
                  <TableRow key={tenant.id}>
                    <TableCell>
                      <Link
                        href={`/platform/tenants/${encodeURIComponent(tenant.slug)}`}
                        className="font-semibold underline-offset-4 hover:underline"
                      >
                        {tenant.name}
                      </Link>
                      <div className="mt-1 text-xs text-muted-foreground" dir="ltr">
                        {tenant.slug}
                      </div>
                    </TableCell>
                    <TableCell>
                      {tenant.accounts.length > 0 ? (
                        <div className="grid gap-1.5">
                          {tenant.accounts.map((account) => (
                            <div
                              key={account.username}
                              className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-md border bg-muted/20 px-2 py-1.5"
                            >
                              <div className="min-w-0">
                                <div className="truncate text-sm font-medium break-normal">
                                  {account.name}
                                </div>
                                <div
                                  className="truncate text-[11px] text-muted-foreground"
                                  dir="ltr"
                                >
                                  {account.username}
                                </div>
                              </div>
                              <Badge
                                variant={account.isOwner ? "secondary" : "outline"}
                                className="shrink-0 text-[10px]"
                              >
                                {account.isOwner ? t("primaryManager") : t("seniorAccount")}
                              </Badge>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <span className="text-muted-foreground">{t("noManager")}</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant={key === "active" ? "secondary" : "outline"}>{t(key)}</Badge>
                    </TableCell>
                    <TableCell className="text-center font-semibold numeric">
                      {tenant.accountCount}
                      <div className="mt-1 text-[11px] font-normal text-muted-foreground">
                        {t("accountSummary", {
                          active: tenant.activeAccountCount,
                          suspended: tenant.suspendedAccountCount,
                        })}
                      </div>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {dateFormatter.format(tenant.createdAt)}
                    </TableCell>
                    <TableCell className="w-[30%] min-w-0 border-s bg-muted/10">
                      <div className="space-y-2">
                        <form
                          action={requestTenantRename}
                          className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2"
                        >
                          <input type="hidden" name="requestId" value={randomUUID()} />
                          <input type="hidden" name="slug" value={tenant.slug} />
                          <input
                            name="name"
                            defaultValue={tenant.name}
                            required
                            maxLength={160}
                            aria-label={t("editUniversity")}
                            className="h-8 min-w-0 flex-1 rounded-md border bg-transparent px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                          />
                          <PendingSubmitButton
                            size="xs"
                            variant="outline"
                            pendingChildren={t("saving")}
                          >
                            {t("rename")}
                          </PendingSubmitButton>
                        </form>
                        <details className="rounded-lg border border-dashed p-2">
                          <summary className="cursor-pointer text-xs font-medium">
                            {t("changeManager")}
                          </summary>
                          <form action={requestTenantOwnerChange} className="mt-2 grid gap-2">
                            <input type="hidden" name="requestId" value={randomUUID()} />
                            <input type="hidden" name="slug" value={tenant.slug} />
                            <input
                              name="username"
                              defaultValue={tenant.manager?.username ?? ""}
                              required
                              maxLength={64}
                              dir="ltr"
                              aria-label={t("changeManager")}
                              placeholder={t("newManagerUsername")}
                              className="h-8 min-w-0 rounded-md border bg-transparent px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                            />
                            <input
                              name="reason"
                              required
                              minLength={10}
                              maxLength={500}
                              aria-label={t("ownerChangeReason")}
                              placeholder={t("ownerChangeReasonPlaceholder")}
                              className="h-8 min-w-0 rounded-md border bg-transparent px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                            />
                            <input
                              name="confirmation"
                              required
                              dir="ltr"
                              aria-label={t("ownerChangeConfirmation")}
                              placeholder={`CHANGE-OWNER:${tenant.slug}:username`}
                              className="h-8 min-w-0 rounded-md border bg-transparent px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                            />
                            <p className="text-[11px] text-muted-foreground">
                              {t("ownerChangeHint")}
                            </p>
                            <PendingSubmitButton
                              size="xs"
                              variant="outline"
                              pendingChildren={t("saving")}
                            >
                              {t("changeManager")}
                            </PendingSubmitButton>
                          </form>
                        </details>
                        <form
                          action={requestTenantUserPasswordReset}
                          className="grid gap-2 rounded-lg border border-dashed p-2"
                        >
                          <input type="hidden" name="requestId" value={randomUUID()} />
                          <input type="hidden" name="slug" value={tenant.slug} />
                          <span className="text-xs font-medium">{t("resetManagerPassword")}</span>
                          <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-2">
                            <input
                              name="username"
                              defaultValue={tenant.manager?.username ?? ""}
                              required
                              maxLength={64}
                              dir="ltr"
                              aria-label={t("resetManagerUsername")}
                              placeholder={t("resetManagerUsername")}
                              className="h-8 min-w-0 flex-1 rounded-md border bg-transparent px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                            />
                            <input
                              name="password"
                              required
                              minLength={12}
                              maxLength={128}
                              type="password"
                              autoComplete="new-password"
                              aria-label={t("newManagerPassword")}
                              placeholder={t("newManagerPassword")}
                              className="h-8 min-w-0 flex-1 rounded-md border bg-transparent px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                            />
                            <PendingSubmitButton
                              size="xs"
                              variant="outline"
                              pendingChildren={t("saving")}
                              className="col-span-2 w-full"
                            >
                              {t("resetPassword")}
                            </PendingSubmitButton>
                          </div>
                          <span className="text-[11px] text-muted-foreground">
                            {t("resetManagerPasswordHint")}
                          </span>
                        </form>
                        <div className="flex flex-wrap gap-1.5">
                          {tenant.status === "active" || tenant.status === "suspended" ? (
                            <form action={requestTenantLifecycle}>
                              <input type="hidden" name="requestId" value={randomUUID()} />
                              <input type="hidden" name="slug" value={tenant.slug} />
                              <input
                                type="hidden"
                                name="action"
                                value={
                                  tenant.status === "active" ? "tenant.suspend" : "tenant.resume"
                                }
                              />
                              <PendingSubmitButton
                                size="xs"
                                variant="outline"
                                pendingChildren={t("saving")}
                              >
                                {tenant.status === "active" ? t("suspend") : t("resume")}
                              </PendingSubmitButton>
                            </form>
                          ) : null}
                          {tenant.status !== "archived" ? (
                            <ArchiveTenantButton
                              slug={tenant.slug}
                              requestId={randomUUID()}
                              labels={{
                                archive: t("archive"),
                                title: t("archiveConfirmTitle"),
                                description: t("archiveConfirmDescription", { name: tenant.name }),
                                instruction: t("archiveConfirmInstruction"),
                                confirmationLabel: t("archiveConfirmLabel"),
                                cancel: t("cancel"),
                                submitting: t("submittingOperation"),
                              }}
                            />
                          ) : null}
                        </div>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
