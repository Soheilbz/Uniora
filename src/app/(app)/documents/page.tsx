import { Download, FileArchive, FileCheck2, FileClock, FileWarning, Paperclip } from "lucide-react";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { AttachmentUploader } from "@/components/engine/attachment-uploader.tsx";
import { PageBody, PageHeader } from "@/components/page-header.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Card, CardContent } from "@/components/ui/card.tsx";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty.tsx";
import {
  canManageDocumentEntity,
  type DocumentEntityType,
  entityHref,
  isDocumentEntityType,
} from "@/lib/documents/access.ts";
import { requireModule } from "@/lib/viewer.ts";
import { finalizeManagedAttachmentAction } from "@/modules/documents/actions.ts";
import { readManagedAttachments } from "@/modules/documents/queries.ts";

interface Params {
  entityType?: string | string[];
  entityId?: string | string[];
}

export async function generateMetadata() {
  const t = await getTranslations("documentCenter");
  return { title: t("title") };
}

function one(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

export default async function DocumentsPage({ searchParams }: { searchParams: Promise<Params> }) {
  const { viewer } = await requireModule("/documents");
  const params = await searchParams;
  const rawType = one(params.entityType).trim();
  const entityId = one(params.entityId).trim().slice(0, 120);
  const entityType: DocumentEntityType | null =
    isDocumentEntityType(rawType) && entityId ? rawType : null;
  const filter = entityType ? { entityType, entityId } : null;
  const [t, format, items] = await Promise.all([
    getTranslations("documentCenter"),
    getFormatter(),
    readManagedAttachments(viewer, filter),
  ]);
  const manageContext = Boolean(entityType && canManageDocumentEntity(viewer, entityType));
  const uploaderWords = {
    file: t("upload.file"),
    classification: t("upload.classification"),
    upload: t("upload.action"),
    uploading: t("upload.uploading"),
    done: t("upload.done"),
    public: t("classification.public"),
    internal: t("classification.internal"),
    confidential: t("classification.confidential"),
    restricted: t("classification.restricted"),
    invalid: t("upload.invalid"),
    forbidden: t("upload.forbidden"),
    not_found: t("upload.notFound"),
    storage: t("upload.storage"),
    failed: t("upload.failed"),
  };

  return (
    <PageBody className="gap-4">
      <PageHeader title={t("title")} description={filter ? t("contextSubtitle") : t("subtitle")} />
      {filter && manageContext ? (
        <AttachmentUploader
          entityType={filter.entityType}
          entityId={filter.entityId}
          t={uploaderWords}
        />
      ) : null}
      {filter ? (
        <div className="flex items-center justify-between gap-3 text-sm text-muted-foreground">
          <span className="font-mono" dir="ltr">
            {filter.entityType}:{filter.entityId}
          </span>
          <Button
            variant="ghost"
            size="sm"
            nativeButton={false}
            render={<Link href="/documents">{t("showAll")}</Link>}
          />
        </div>
      ) : null}

      {items.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <FileArchive aria-hidden />
            </EmptyMedia>
            <EmptyTitle>{t("emptyTitle")}</EmptyTitle>
            <EmptyDescription>{t("emptyBody")}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="grid gap-2">
          {items.map((item) => {
            const itemType = isDocumentEntityType(item.entityType) ? item.entityType : null;
            const href = itemType ? entityHref(itemType, item.entityId) : null;
            const StatusIcon =
              item.status === "available"
                ? FileCheck2
                : item.status === "rejected"
                  ? FileWarning
                  : FileClock;
            return (
              <Card key={item.id}>
                <CardContent className="flex flex-col gap-3 p-4 md:flex-row md:items-center">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Paperclip className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                      <p className="truncate font-medium">{item.filename}</p>
                      <Badge variant="outline" className="gap-1">
                        <StatusIcon className="size-3" aria-hidden />
                        {t(`status.${item.status}`)}
                      </Badge>
                      <Badge variant="secondary">
                        {t(`classification.${item.classification}`)}
                      </Badge>
                      {item.finalizedVersion ? (
                        <Badge variant="outline">
                          {t("finalized", { version: item.finalizedVersion })}
                        </Badge>
                      ) : null}
                      {item.signed ? <Badge variant="default">{t("signed")}</Badge> : null}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      <span>
                        {format.number(item.sizeBytes)} {t("bytes")}
                      </span>
                      <span>
                        {format.dateTime(item.uploadedAt, {
                          dateStyle: "medium",
                          timeStyle: "short",
                        })}
                      </span>
                      {item.uploaderName && <span>{item.uploaderName}</span>}
                      {item.sha256 && (
                        <span className="font-mono" dir="ltr">
                          SHA-256 {item.sha256.slice(0, 12)}…
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    {href ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        nativeButton={false}
                        render={<Link href={href}>{t("openRecord")}</Link>}
                      />
                    ) : null}
                    {item.status === "available" ? (
                      <Button
                        variant="outline"
                        size="sm"
                        nativeButton={false}
                        render={
                          <Link href={`/documents/${item.id}/download`}>
                            <Download className="size-4" aria-hidden />
                            {t("download")}
                          </Link>
                        }
                      />
                    ) : null}
                    {item.status === "available" &&
                    itemType &&
                    canManageDocumentEntity(viewer, itemType) &&
                    !item.finalizedVersion ? (
                      <form action={finalizeManagedAttachmentAction}>
                        <input type="hidden" name="attachmentId" value={item.id} />
                        <input type="hidden" name="sign" value="false" />
                        <Button type="submit" size="sm" variant="outline">
                          {t("finalize")}
                        </Button>
                      </form>
                    ) : null}
                    {item.status === "available" &&
                    itemType &&
                    canManageDocumentEntity(viewer, itemType) &&
                    !item.signed ? (
                      <form action={finalizeManagedAttachmentAction}>
                        <input type="hidden" name="attachmentId" value={item.id} />
                        <input type="hidden" name="sign" value="true" />
                        <Button type="submit" size="sm">
                          {t("finalizeSign")}
                        </Button>
                      </form>
                    ) : null}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </PageBody>
  );
}
