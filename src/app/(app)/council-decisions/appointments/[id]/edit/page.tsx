import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { DeleteRecordButton } from "@/components/engine/delete-record-button";
import { EntityForm } from "@/components/engine/entity-form";
import { PageBody, PageHeader } from "@/components/page-header";
import { isUuid } from "@/lib/uuid.ts";
import { requireCapability } from "@/lib/viewer.ts";
import { APPOINTMENT_FIELDS, APPOINTMENT_GROUPS } from "@/modules/council/fields.ts";
import { buildCouncilForm } from "@/modules/council/form-data.ts";
import { readAppointment } from "@/modules/council/registers.ts";
import { deleteAppointments, saveAppointment } from "@/modules/council/tab-actions.ts";
import { readProfessorOptions } from "@/modules/directory/options.ts";

export async function generateMetadata() {
  const words = await getTranslations("appointments");
  return { title: words("editTitle") };
}

export default async function EditAppointmentPage({ params }: { params: Promise<{ id: string }> }) {
  const viewer = await requireCapability("council.view", "council.manage");
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const record = await readAppointment(viewer.tenantId, id);
  if (!record) notFound();
  const professors = await readProfessorOptions(viewer.tenantId);

  const [props, words, common, nav] = await Promise.all([
    buildCouncilForm(
      viewer.tenantId,
      APPOINTMENT_FIELDS,
      APPOINTMENT_GROUPS,
      "decisions",
      record,
      professors,
    ),
    getTranslations("appointments"),
    getTranslations("common"),
    getTranslations("nav"),
  ]);

  return (
    <PageBody>
      <PageHeader
        title={words("editTitle")}
        breadcrumbLabel={nav("breadcrumb")}
        breadcrumbs={[
          { label: words("title"), href: "/council-decisions?tab=appointments" },
          { label: words("editTitle") },
        ]}
        actions={
          <DeleteRecordButton
            action={deleteAppointments}
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
      <EntityForm
        action={saveAppointment}
        fields={APPOINTMENT_FIELDS}
        groups={APPOINTMENT_GROUPS}
        multiline={[]}
        recordId={record.id}
        version={record.version}
        extraFields={record.meetingId ? { meetingId: record.meetingId } : {}}
        cancelHref={`/council-decisions/appointments/${record.id}`}
        submitLabel={common("save")}
        {...props}
      />
    </PageBody>
  );
}
