import { Archive, MailPlus, Paperclip, Send, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { PageBody, PageHeader } from "@/components/page-header.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card.tsx";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Textarea } from "@/components/ui/textarea.tsx";
import { can } from "@/lib/capabilities.ts";
import { requireModule } from "@/lib/viewer.ts";
import {
  createCorrespondence,
  transitionCorrespondence,
} from "@/modules/correspondence/actions.ts";
import { readCorrespondence } from "@/modules/correspondence/queries.ts";

export async function generateMetadata() {
  const t = await getTranslations("correspondence");
  return { title: t("title") };
}

export default async function CorrespondencePage() {
  const { viewer } = await requireModule("/correspondence");
  const [t, locale, items] = await Promise.all([
    getTranslations("correspondence"),
    getLocale(),
    readCorrespondence(viewer.tenantId),
  ]);
  const manage = can(viewer, "correspondence.manage");

  return (
    <PageBody className="gap-4">
      <PageHeader title={t("title")} description={t("subtitle")} />

      {manage && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("new")}</CardTitle>
          </CardHeader>
          <CardContent>
            <form
              action={createCorrespondence}
              className="grid gap-3 md:grid-cols-2 xl:grid-cols-4"
            >
              <label className="grid gap-1 text-sm">
                <span>{t("fields.direction")}</span>
                <select
                  name="direction"
                  defaultValue="incoming"
                  className="h-9 rounded-lg border border-input bg-background px-3"
                >
                  <option value="incoming">{t("direction.incoming")}</option>
                  <option value="outgoing">{t("direction.outgoing")}</option>
                  <option value="internal">{t("direction.internal")}</option>
                </select>
              </label>
              <label className="grid gap-1 text-sm">
                <span>{t("fields.classification")}</span>
                <select
                  name="classification"
                  defaultValue="internal"
                  className="h-9 rounded-lg border border-input bg-background px-3"
                >
                  <option value="public">{t("classification.public")}</option>
                  <option value="internal">{t("classification.internal")}</option>
                  <option value="confidential">{t("classification.confidential")}</option>
                  <option value="restricted">{t("classification.restricted")}</option>
                </select>
              </label>
              <label className="grid gap-1 text-sm">
                <span>{t("fields.number")}</span>
                <Input name="number" maxLength={120} placeholder={t("numberPending")} />
              </label>
              <label className="grid gap-1 text-sm">
                <span>{t("fields.dueOn")}</span>
                <Input name="dueOn" type="date" />
              </label>
              <label className="grid gap-1 text-sm md:col-span-2">
                <span>{t("fields.subject")}</span>
                <Input name="subject" required maxLength={500} />
              </label>
              <label className="grid gap-1 text-sm">
                <span>{t("fields.sender")}</span>
                <Input name="sender" maxLength={300} />
              </label>
              <label className="grid gap-1 text-sm">
                <span>{t("fields.recipient")}</span>
                <Input name="recipient" maxLength={300} />
              </label>
              <label className="grid gap-1 text-sm md:col-span-2 xl:col-span-4">
                <span>{t("fields.body")}</span>
                <Textarea name="body" maxLength={10000} />
              </label>
              <div className="md:col-span-2 xl:col-span-4 flex justify-end">
                <Button type="submit">
                  <MailPlus className="size-4" aria-hidden />
                  {t("create")}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {items.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Archive aria-hidden />
            </EmptyMedia>
            <EmptyTitle>{t("emptyTitle")}</EmptyTitle>
            <EmptyDescription>{t("emptyBody")}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="grid gap-2">
          {items.map((item) => (
            <Card key={item.id}>
              <CardContent className="flex flex-col gap-3 p-4 lg:flex-row lg:items-center">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium">{item.subject}</p>
                    <Badge variant="outline">{t(`direction.${item.direction}`)}</Badge>
                    <Badge variant="secondary">{t(`status.${item.status}`)}</Badge>
                    <Badge variant="outline" className="gap-1">
                      <ShieldCheck className="size-3" aria-hidden />
                      {t(`classification.${item.classification}`)}
                    </Badge>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {item.number ?? t("numberPending")}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    {item.sender && <span>{item.sender}</span>}
                    {item.recipients[0] && (
                      <span>
                        {t("recipient")}: {item.recipients.join(", ")}
                      </span>
                    )}
                    {item.dueAt && (
                      <span>
                        {new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(
                          item.dueAt,
                        )}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  <Button
                    nativeButton={false}
                    render={
                      <Link href={`/documents?entityType=correspondence&entityId=${item.id}`} />
                    }
                    size="sm"
                    variant="ghost"
                  >
                    <Paperclip className="size-4" aria-hidden />
                    {t("documents")}
                  </Button>
                  {manage && item.status !== "closed" && item.status !== "cancelled" && (
                    <form action={transitionCorrespondence} className="flex items-center gap-2">
                      <input type="hidden" name="id" value={item.id} />
                      <input type="hidden" name="version" value={item.version} />
                      <select
                        name="status"
                        defaultValue={item.status}
                        className="h-9 rounded-lg border border-input bg-background px-2 text-sm"
                      >
                        {item.status === "draft" && (
                          <>
                            <option value="draft">{t("status.draft")}</option>
                            <option value="registered">{t("status.registered")}</option>
                            <option value="cancelled">{t("status.cancelled")}</option>
                          </>
                        )}
                        {item.status === "registered" && (
                          <>
                            <option value="registered">{t("status.registered")}</option>
                            <option value="referred">{t("status.referred")}</option>
                            <option value="closed">{t("status.closed")}</option>
                            <option value="cancelled">{t("status.cancelled")}</option>
                          </>
                        )}
                        {item.status === "referred" && (
                          <>
                            <option value="referred">{t("status.referred")}</option>
                            <option value="registered">{t("status.registered")}</option>
                            <option value="closed">{t("status.closed")}</option>
                            <option value="cancelled">{t("status.cancelled")}</option>
                          </>
                        )}
                      </select>
                      <Button type="submit" size="sm" variant="outline">
                        <Send className="size-4" aria-hidden />
                        {t("update")}
                      </Button>
                    </form>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </PageBody>
  );
}
