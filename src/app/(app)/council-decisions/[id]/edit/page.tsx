import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { DeleteRecordButton } from "@/components/engine/delete-record-button";
import { EntityForm } from "@/components/engine/entity-form";
import { PageBody, PageHeader } from "@/components/page-header";
import { isUuid } from "@/lib/uuid.ts";
import { requireCapability } from "@/lib/viewer.ts";
import { deleteDecisions, saveDecision } from "@/modules/council/actions.ts";
import { DECISION_FIELDS, DECISION_GROUPS } from "@/modules/council/fields.ts";
import { buildCouncilForm } from "@/modules/council/form-data.ts";
import { readDecision } from "@/modules/council/queries.ts";

export async function generateMetadata() {
  const t = await getTranslations("decisions");
  return { title: t("editTitle") };
}

export default async function EditDecisionPage({ params }: { params: Promise<{ id: string }> }) {
  const viewer = await requireCapability("council.view", "council.manage");
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const decision = await readDecision(viewer.tenantId, id);
  if (!decision) notFound();

  const [props, t, common, nav] = await Promise.all([
    buildCouncilForm(viewer.tenantId, DECISION_FIELDS, DECISION_GROUPS, "decisions", decision),
    getTranslations("decisions"),
    getTranslations("common"),
    getTranslations("nav"),
  ]);

  const name = decision.studentName ?? decision.thesisTitle ?? decision.meetingNumber;

  return (
    <PageBody>
      <PageHeader
        title={t("editTitle")}
        description={name}
        breadcrumbLabel={nav("breadcrumb")}
        breadcrumbs={[
          { label: t("title"), href: "/council-decisions" },
          { label: name, href: `/council-decisions/${decision.id}` },
          { label: t("editTitle") },
        ]}
        actions={
          <DeleteRecordButton
            action={deleteDecisions}
            recordId={decision.id}
            recordVersion={decision.version}
            title={t("deleteTitle")}
            body={t("deleteBody")}
            confirmLabel={common("delete")}
            cancelLabel={common("cancel")}
            triggerLabel={common("delete")}
          />
        }
      />
      {/*
       * `meetingId` rides along as a hidden field: the form edits the sitting's
       * *number* and *date* — which is what the minute recorded — while the link
       * to the sitting record is an id the operator never types.
       */}
      <EntityForm
        action={saveDecision}
        fields={DECISION_FIELDS}
        groups={DECISION_GROUPS}
        multiline={["thesisTitle", "decisionText", "councilNotes", "achievements"]}
        recordId={decision.id}
        version={decision.version}
        extraFields={decision.meetingId ? { meetingId: decision.meetingId } : {}}
        cancelHref={`/council-decisions/${decision.id}`}
        submitLabel={common("save")}
        {...props}
      />
    </PageBody>
  );
}
