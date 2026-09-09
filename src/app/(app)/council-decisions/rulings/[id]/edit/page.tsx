import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { DeleteRecordButton } from "@/components/engine/delete-record-button";
import { PageBody, PageHeader } from "@/components/page-header";
import { isUuid } from "@/lib/uuid.ts";
import { requireCapability } from "@/lib/viewer.ts";
import { RULING_FIELDS, RULING_GROUPS } from "@/modules/council/fields.ts";
import { buildCouncilForm } from "@/modules/council/form-data.ts";
import { readRuling } from "@/modules/council/registers.ts";
import { deleteRulings, saveRuling } from "@/modules/council/tab-actions.ts";
import { readPublishedDecisionTemplates } from "@/modules/governance/official-rules.ts";
import { RulingForm } from "../../ruling-form.tsx";

export async function generateMetadata() {
  const words = await getTranslations("rulings");
  return { title: words("editTitle") };
}

export default async function EditRulingPage({ params }: { params: Promise<{ id: string }> }) {
  const viewer = await requireCapability("council.view", "council.manage");
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const record = await readRuling(viewer.tenantId, id);
  if (!record) notFound();

  const [props, words, common, nav, templates] = await Promise.all([
    buildCouncilForm(viewer.tenantId, RULING_FIELDS, RULING_GROUPS, "decisions", record),
    getTranslations("rulings"),
    getTranslations("common"),
    getTranslations("nav"),
    readPublishedDecisionTemplates(viewer.tenantId, record.templateVersionId),
  ]);

  return (
    <PageBody>
      <PageHeader
        title={words("editTitle")}
        breadcrumbLabel={nav("breadcrumb")}
        breadcrumbs={[
          { label: words("title"), href: "/council-decisions?tab=rulings" },
          { label: words("editTitle") },
        ]}
        actions={
          <DeleteRecordButton
            action={deleteRulings}
            recordId={record.id}
            recordVersion={record.version}
            title={words("deleteTitle")}
            body={words("deleteBody")}
            confirmLabel={common("delete")}
            cancelLabel={common("cancel")}
            triggerLabel={common("delete")}
          />
        }
      />
      <RulingForm
        action={saveRuling}
        fields={RULING_FIELDS}
        groups={RULING_GROUPS}
        multiline={["decisionText", "decisionDescription"]}
        recordId={record.id}
        version={record.version}
        extraFields={record.meetingId ? { meetingId: record.meetingId } : {}}
        cancelHref={`/council-decisions/rulings/${record.id}`}
        submitLabel={common("save")}
        templates={templates}
        {...props}
      />
    </PageBody>
  );
}
