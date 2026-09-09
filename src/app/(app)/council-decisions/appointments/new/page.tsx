import { getTranslations } from "next-intl/server";
import { EntityForm } from "@/components/engine/entity-form";
import { PageBody, PageHeader } from "@/components/page-header";
import { requireCapability } from "@/lib/viewer.ts";
import { APPOINTMENT_FIELDS, APPOINTMENT_GROUPS } from "@/modules/council/fields.ts";
import { buildCouncilForm } from "@/modules/council/form-data.ts";
import { saveAppointment } from "@/modules/council/tab-actions.ts";
import { readProfessorOptions } from "@/modules/directory/options.ts";

export async function generateMetadata() {
  const words = await getTranslations("appointments");
  return { title: words("newTitle") };
}

export default async function NewAppointmentPage() {
  const viewer = await requireCapability("council.view", "council.manage");
  const professors = await readProfessorOptions(viewer.tenantId);
  const [props, words, common, nav] = await Promise.all([
    buildCouncilForm(
      viewer.tenantId,
      APPOINTMENT_FIELDS,
      APPOINTMENT_GROUPS,
      "decisions",
      undefined,
      professors,
    ),
    getTranslations("appointments"),
    getTranslations("common"),
    getTranslations("nav"),
  ]);

  return (
    <PageBody>
      <PageHeader
        title={words("newTitle")}
        breadcrumbLabel={nav("breadcrumb")}
        breadcrumbs={[
          { label: words("title"), href: "/council-decisions?tab=appointments" },
          { label: words("newTitle") },
        ]}
      />
      <EntityForm
        action={saveAppointment}
        fields={APPOINTMENT_FIELDS}
        groups={APPOINTMENT_GROUPS}
        multiline={[]}
        cancelHref="/council-decisions?tab=appointments"
        submitLabel={common("save")}
        {...props}
      />
    </PageBody>
  );
}
