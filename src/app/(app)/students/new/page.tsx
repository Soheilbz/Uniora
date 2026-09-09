import { getTranslations } from "next-intl/server";
import { EntityForm } from "@/components/engine/entity-form";
import { PageBody, PageHeader } from "@/components/page-header";
import { requireCapability } from "@/lib/viewer.ts";
import { createStudent } from "@/modules/students/actions.ts";
import { FIELD_GROUPS, STUDENT_FIELDS } from "@/modules/students/fields.ts";
import { buildFormProps } from "@/modules/students/form-data.ts";

/**
 * A new student.
 *
 * Gated on `students.manage` rather than on the module's own `students.view`:
 * reading the register and adding to it are different permissions, and this
 * page is the second one. The action re-checks it — the gate here decides
 * whether the form is drawn, and the action decides whether the record is
 * written.
 */

export async function generateMetadata() {
  const t = await getTranslations("students");
  return { title: t("newTitle") };
}

export default async function NewStudentPage() {
  const viewer = await requireCapability("students.view", "students.manage");
  const [props, t, common, nav] = await Promise.all([
    buildFormProps(viewer.tenantId),
    getTranslations("students"),
    getTranslations("common"),
    getTranslations("nav"),
  ]);

  return (
    <PageBody>
      <PageHeader
        title={t("newTitle")}
        breadcrumbLabel={nav("breadcrumb")}
        breadcrumbs={[{ label: nav("students"), href: "/students" }, { label: t("newTitle") }]}
      />
      <EntityForm
        action={createStudent}
        fields={STUDENT_FIELDS}
        groups={FIELD_GROUPS}
        cancelHref="/students"
        submitLabel={common("save")}
        {...props}
      />
    </PageBody>
  );
}
